// Syntix Card 1.1 – eigene Karte gestalten (Bankkarten-Look oder Kundenkarte), Bilder für Apple Wallet erzeugen.
// Alles läuft im Browser (Canvas). Karten liegen in IndexedDB auf dem Gerät, es wird nichts hochgeladen.
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const APP_VERSION = '1.1';
const PT = 3;                                   // px pro pt im Wallet-Export (@3x)
const STRIP_W = 375 * PT, STRIP_H = 123 * PT;   // Wallet-Banner 1125×369
const CARD_W = 1200, CARD_H = 756;              // Bankkarte 85,6 × 54 mm
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const OLD_KEY = 'syntix-card-v1', CUR_KEY = 'syntix-card-current';

const THEMES = [
  { bg: '#111114', fg: '#ffffff', lb: '#a1a1aa' },
  { bg: '#ffffff', fg: '#111114', lb: '#7a7a86' },
  { bg: '#1e1b4b', fg: '#ffffff', lb: '#a5b4fc' },
  { bg: '#0b1f3a', fg: '#ffffff', lb: '#7fb2ff' },
  { bg: '#0f3d36', fg: '#ffffff', lb: '#7fe0c8' },
  { bg: '#7f1d1d', fg: '#ffffff', lb: '#fca5a5' },
  { bg: '#f5e9d7', fg: '#2b2118', lb: '#9a7b5a' },
  { bg: '#c9c9d1', fg: '#111114', lb: '#55555f' },
];
const FILTERS = [['none', 'Original'], ['bw', 'S/W'], ['warm', 'Warm'], ['cold', 'Kalt'], ['vivid', 'Kräftig'], ['fade', 'Matt']];
const EFFECTS = [['none', 'Ohne'], ['glass', 'Glanz'], ['metal', 'Metall'], ['holo', 'Holo'], ['carbon', 'Carbon'], ['gradient', 'Verlauf'], ['grain', 'Körnung']];

const DEFAULTS = {
  look: 'bank', img: null, zoom: 1, ox: 0, oy: 0, bright: 0, shade: 25, filter: 'none', fx: 'glass',
  title: 'Syntix', holder: 'Dein Name', last4: '1234', chip: true, nfc: true, showNum: true,
  bigLabel: 'Mitglied', big: 'SYNTIX', f1l: 'Name', f1v: 'Dein Name', f2l: 'Nummer', f2v: '0001',
  ...THEMES[0], qrOn: false, qr: 'Syntix Card', qrText: '', burn: false,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const newCard = (extra = {}) => ({ ...DEFAULTS, id: uid(), created: Date.now(), updated: Date.now(), ...extra });

let cards = [];              // alle Karten (im Speicher)
let state = newCard();       // die gerade offene Karte (Objekt aus cards)
let img = null;              // geladenes Bild der offenen Karte
let view = 'card';           // Vorschau im Bankkarten-Look: 'card' oder 'wallet'

// ---------- Helfer ----------
const loadImg = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const font = (weight, ptSize) => `${weight} ${Math.round(ptSize * PT)}px ${FONT}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isBank = () => state.look === 'bank';

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Text mit Buchstabenabstand (ctx.letterSpacing gibt es nicht in jedem Safari)
function spacedText(ctx, text, x, y, sp, align = 'left') {
  const chars = [...text];
  const total = chars.reduce((s, ch) => s + ctx.measureText(ch).width, 0) + sp * (chars.length - 1);
  let cx = align === 'right' ? x - total : x;
  const old = ctx.textAlign; ctx.textAlign = 'left';
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  ctx.textAlign = old;
  return total;
}
function spacedWidth(ctx, text, sp) {
  const chars = [...text];
  return chars.reduce((s, ch) => s + ctx.measureText(ch).width, 0) + sp * (chars.length - 1);
}

// Fester Zufall, damit Vorschau und Export gleich aussehen
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------- Speicher (IndexedDB) ----------
const store = {
  db: null,
  async open() {
    if (!('indexedDB' in window)) return;
    this.db = await new Promise((ok, fail) => {
      const r = indexedDB.open('syntix-card', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('cards', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  },
  tx(mode, fn) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((ok, fail) => {
      const t = this.db.transaction('cards', mode), req = fn(t.objectStore('cards'));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = t.onabort = () => fail(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()); },
  put(c) { return this.tx('readwrite', s => s.put(c)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};

let saveT, saveWarned = false;
function saveNow() {
  clearTimeout(saveT); saveT = 0;
  state.updated = Date.now();
  try { state.thumb = makeThumb().toDataURL('image/jpeg', .82); } catch { /* egal */ }
  return store.put({ ...state }).catch(() => {
    if (!saveWarned) { saveWarned = true; toast('Speichern ging nicht – ist der Speicher voll?'); }
  });
}
function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); }
const flush = () => (saveT ? saveNow() : Promise.resolve());

// ---------- Bild & Filter ----------
let filtered = null, filteredFor = null, filteredKind = '';
function source() {
  if (!img) return null;
  if (state.filter === 'none') return img;
  if (filteredFor === img && filteredKind === state.filter) return filtered;
  const c = canvas(img.naturalWidth, img.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data, f = state.filter;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i + 1], b = p[i + 2];
    const l = .299 * r + .587 * g + .114 * b;
    if (f === 'bw') { r = g = b = (l - 128) * 1.15 + 128; }
    else if (f === 'warm') { r = r * 1.08 + 12; g = g * 1.02 + 4; b = b * .86; }
    else if (f === 'cold') { r = r * .88; g = g + 2; b = b * 1.08 + 14; }
    else if (f === 'vivid') { r = ((l + (r - l) * 1.35) - 128) * 1.18 + 128; g = ((l + (g - l) * 1.35) - 128) * 1.18 + 128; b = ((l + (b - l) * 1.35) - 128) * 1.18 + 128; }
    else if (f === 'fade') { r = (l + (r - l) * .7) * .8 + 40; g = (l + (g - l) * .7) * .8 + 38; b = (l + (b - l) * .7) * .8 + 44; }
    p[i] = r; p[i + 1] = g; p[i + 2] = b;
  }
  x.putImageData(d, 0, 0);
  filtered = c; filteredFor = img; filteredKind = f;
  return c;
}

// Bildausschnitt: Bild deckt W×H ab, ox/oy sind Anteile der Breite (gleich für Karte und Banner)
function geom(W, H) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * state.zoom;
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  return { w, h, mx: (w - W) / 2, my: (h - H) / 2 };
}
function clampOffset(W, H) {
  if (!img) return;
  const { mx, my } = geom(W, H);
  state.ox = clamp(state.ox, -mx / W, mx / W);
  state.oy = clamp(state.oy, -my / W, my / W);
}

// ---------- Effekte ----------
const tiles = {};
function tile(kind) {
  if (tiles[kind]) return tiles[kind];
  const r = rng(kind.length * 977 + 13);
  let c;
  if (kind === 'grain') {
    c = canvas(160, 160); const x = c.getContext('2d'), d = x.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
  } else if (kind === 'metal') {                 // gebürstet: viele feine waagrechte Striche
    c = canvas(1200, 380); const x = c.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, 1200, 380);
    for (let i = 0; i < 2600; i++) {
      const y = r() * 380, len = 120 + r() * 900, sx = r() * 1200 - 200, v = Math.round(90 + r() * 80);
      x.fillStyle = `rgba(${v},${v},${v},${.25 + r() * .5})`; x.fillRect(sx, y, len, 1 + (r() < .2 ? 1 : 0));
    }
  } else if (kind === 'carbon') {               // Karbon-Gewebe
    c = canvas(24, 24); const x = c.getContext('2d');
    const cell = (cx, cy, vertical) => {
      const g = vertical ? x.createLinearGradient(cx, cy, cx + 12, cy) : x.createLinearGradient(cx, cy, cx, cy + 12);
      g.addColorStop(0, '#1a1a1c'); g.addColorStop(.5, '#4a4a50'); g.addColorStop(1, '#141416');
      x.fillStyle = g; x.fillRect(cx, cy, 12, 12);
    };
    cell(0, 0, false); cell(12, 0, true); cell(0, 12, true); cell(12, 12, false);
  }
  return (tiles[kind] = c);
}
function patternFill(ctx, kind, W, H, scale = 1) {
  const p = ctx.createPattern(tile(kind), 'repeat');
  ctx.save(); ctx.scale(scale, scale); ctx.fillStyle = p; ctx.fillRect(0, 0, W / scale, H / scale); ctx.restore();
}

function drawFx(ctx, W, H) {
  const fx = state.fx;
  if (fx === 'none') return;
  ctx.save();
  if (fx === 'glass') {
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(0, 0, W * .55, H);
    g.addColorStop(0, 'rgba(255,255,255,.34)'); g.addColorStop(.42, 'rgba(255,255,255,.07)'); g.addColorStop(.43, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.beginPath(); ctx.moveTo(W * .56, 0); ctx.lineTo(W * .7, 0); ctx.lineTo(W * .44, H); ctx.lineTo(W * .3, H); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill();
  } else if (fx === 'metal') {
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,.55)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .7; ctx.drawImage(tile('metal'), 0, 0, W, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'soft-light';
    const g = ctx.createLinearGradient(0, 0, W, H * .4);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.3, 'rgba(255,255,255,.75)'); g.addColorStop(.45, 'rgba(0,0,0,.25)');
    g.addColorStop(.7, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(0,0,0,.2)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (fx === 'holo') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .7;
    const g = ctx.createLinearGradient(0, H, W, 0);
    ['#ff6ec7', '#ffd36e', '#7afcff', '#b388ff', '#6effa8', '#ff6ec7'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'screen';
    const s = ctx.createLinearGradient(0, 0, W, H);
    s.addColorStop(.35, 'rgba(255,255,255,0)'); s.addColorStop(.5, 'rgba(255,255,255,.22)'); s.addColorStop(.65, 'rgba(255,255,255,0)');
    ctx.fillStyle = s; ctx.fillRect(0, 0, W, H);
  } else if (fx === 'carbon') {
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .9;
    patternFill(ctx, 'carbon', W, H, Math.max(.5, W / 1200));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (fx === 'gradient') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .85;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, state.lb); g.addColorStop(1, state.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (fx === 'grain') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .32;
    patternFill(ctx, 'grain', W, H, Math.max(.5, W / 1200));
  }
  ctx.restore();
}

// Hintergrund: Bild (oder Verlauf) + Helligkeit + Effekt
function drawBackground(ctx, W, H) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  const s = source();
  if (s) {
    const { w, h, mx, my } = geom(W, H);
    ctx.drawImage(s, (W - w) / 2 + clamp(state.ox * W, -mx, mx), (H - h) / 2 + clamp(state.oy * W, -my, my), w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#6d5dfc'); g.addColorStop(1, '#22c3a6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (state.bright < 0) { ctx.fillStyle = `rgba(0,0,0,${-state.bright / 100})`; ctx.fillRect(0, 0, W, H); }
  if (state.bright > 0) {
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(255,255,255,${state.bright / 100})`; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  drawFx(ctx, W, H);
  ctx.restore();
}

function shadeBottom(ctx, W, H) {
  if (state.shade <= 0) return;
  const a = state.shade / 100, g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(.7, `rgba(0,0,0,${a * .25})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------- Bankkarten-Look ----------
function drawChip(ctx, x, y, w, h, u) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 4 * u; ctx.shadowOffsetY = 1.5 * u;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#f7e8b4'); g.addColorStop(.45, '#d6b66b'); g.addColorStop(.55, '#c8a457'); g.addColorStop(1, '#f2dd9c');
  roundRect(ctx, x, y, w, h, 16 * u); ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(105,80,28,.6)'; ctx.lineWidth = 2.4 * u; ctx.stroke();
  // Kontaktflächen
  const ix = x + w * .36, iw = w * .28, iy = y + h * .28, ih = h * .44;
  ctx.beginPath();
  ctx.moveTo(x, y + h / 3); ctx.lineTo(ix, y + h / 3); ctx.moveTo(x, y + h * 2 / 3); ctx.lineTo(ix, y + h * 2 / 3);
  ctx.moveTo(ix + iw, y + h / 3); ctx.lineTo(x + w, y + h / 3); ctx.moveTo(ix + iw, y + h * 2 / 3); ctx.lineTo(x + w, y + h * 2 / 3);
  ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, iy); ctx.moveTo(x + w / 2, iy + ih); ctx.lineTo(x + w / 2, y + h);
  ctx.stroke();
  roundRect(ctx, ix, iy, iw, ih, 8 * u); ctx.stroke();
  ctx.restore();
}

function drawContactless(ctx, cx, cy, u) {
  ctx.save();
  ctx.strokeStyle = state.fg; ctx.lineWidth = 5 * u; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath(); ctx.arc(cx - 26 * u, cy, (12 + i * 11) * u, -.78, .78); ctx.stroke();
  }
  ctx.restore();
}

const cardNumber = () => {
  const d = String(state.last4 || '').replace(/\D/g, '').slice(0, 4);
  return '••••  ••••  ••••  ' + (d || '••••');
};

// strip = true: Layout für das breite Wallet-Banner (1125×369), sonst Bankkarte
function drawBankFace(ctx, W, H, strip) {
  drawBackground(ctx, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  shadeBottom(ctx, W, H);
  const u = strip ? H / 430 : H / 756;
  const pad = strip ? 14 * PT * (H / STRIP_H) : 64 * u;
  ctx.fillStyle = state.fg;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6 * u; ctx.shadowOffsetY = 1.5 * u;
  const holder = (state.holder || '').toUpperCase();

  if (strip) {
    if (state.chip) drawChip(ctx, pad, pad, 150 * u, 112 * u, u);
    if (state.nfc) drawContactless(ctx, pad + (state.chip ? 150 * u + 70 * u : 40 * u), pad + 56 * u, u);
    ctx.textBaseline = 'alphabetic';
    let numW = 0;
    if (state.showNum) {
      ctx.font = `500 ${Math.round(52 * u)}px ${FONT}`;
      numW = spacedText(ctx, cardNumber(), pad, H - pad, 2.5 * u);
    }
    if (holder) {
      ctx.font = `600 ${Math.round(32 * u)}px ${FONT}`;
      const maxW = Math.max(60 * u, W - pad * 3 - numW);
      let t = holder;
      while (t.length > 1 && spacedWidth(ctx, t, 3 * u) > maxW) t = t.slice(0, -1);
      spacedText(ctx, t, W - pad, H - pad, 3 * u, 'right');
    }
  } else {
    if (state.title) {
      ctx.textBaseline = 'top'; ctx.font = `700 ${Math.round(46 * u)}px ${FONT}`;
      ctx.fillText(fitText(ctx, state.title, W - pad * 2 - 90 * u), pad, pad);
    }
    if (state.nfc) drawContactless(ctx, W - pad - 18 * u, pad + 28 * u, u);
    const chipY = H * .36;
    if (state.chip) drawChip(ctx, pad, chipY, 150 * u, 112 * u, u);
    ctx.textBaseline = 'alphabetic';
    if (state.showNum) {
      ctx.font = `500 ${Math.round(60 * u)}px ${FONT}`;
      spacedText(ctx, cardNumber(), pad, H * .36 + 112 * u + 100 * u, 3 * u);
    }
    if (holder) {
      ctx.font = `600 ${Math.round(36 * u)}px ${FONT}`;
      let t = holder;
      while (t.length > 1 && spacedWidth(ctx, t, 3.5 * u) > W - pad * 2) t = t.slice(0, -1);
      spacedText(ctx, t, pad, H - pad, 3.5 * u);
    }
  }
  ctx.restore();
}

// Bankkarte als eigenes Bild mit runden Ecken
function bankCardCanvas(W = CARD_W, H = CARD_H) {
  const c = canvas(W, H), ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, W, H, 46 * W / CARD_W); ctx.clip();
  drawBankFace(ctx, W, H, false);
  return c;
}

// ---------- Wallet-Banner ----------
// Banner zeichnen (1125×369). opts.text: großen Text einbrennen (nur Kundenkarte)
function drawStrip(ctx, opts = {}) {
  if (isBank()) return drawBankFace(ctx, STRIP_W, STRIP_H, true);
  drawBackground(ctx, STRIP_W, STRIP_H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, STRIP_W, STRIP_H); ctx.clip();
  shadeBottom(ctx, STRIP_W, STRIP_H);
  if (opts.text) {
    const left = 14 * PT, maxW = STRIP_W - 28 * PT;
    const base = STRIP_H - 12 * PT - 38 * PT * .24;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = state.fg; ctx.font = font(500, 38);
    if (state.big) ctx.fillText(fitText(ctx, state.big, maxW), left, base);
    ctx.fillStyle = state.lb; ctx.font = font(600, 11);
    if (state.bigLabel) ctx.fillText(fitText(ctx, state.bigLabel.toUpperCase(), maxW), left, base - 38 * PT * .78 - 4 * PT);
  }
  ctx.restore();
}

// Quadratischer Ausschnitt aus der Bildmitte (für Logo und Icon) – ohne Text
function squareCrop(size, radius = 0) {
  const ratio = isBank() ? CARD_W / CARD_H : STRIP_W / STRIP_H;
  const W = Math.round(size * ratio), H = size;
  const src = canvas(W, H); drawBackground(src.getContext('2d'), W, H);
  const c = canvas(size, size), ctx = c.getContext('2d');
  if (radius) { roundRect(ctx, 0, 0, size, size, radius); ctx.clip(); }
  ctx.drawImage(src, (W - H) / 2, 0, H, H, 0, 0, size, size);
  return c;
}

// QR auf eigenen Canvas (ganze Pixel pro Modul, damit er scharf bleibt)
function qrCanvas(target, text, maxPx) {
  const m = QR.matrix(text), n = m.length, mod = Math.max(1, Math.floor(maxPx / n));
  target.width = target.height = n * mod;
  const ctx = target.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n * mod, n * mod);
  QR.draw(ctx, text, 0, 0, n * mod);
  return target;
}
const qrUsable = () => state.qrOn && state.qr.trim() !== '';

// Kleines Vorschaubild für „Meine Karten“
function makeThumb() {
  if (isBank()) return bankCardCanvas(360, 227);
  const c = canvas(360, 227), ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, 360, 227, 14); ctx.clip();
  ctx.fillStyle = state.bg; ctx.fillRect(0, 0, 360, 227);
  ctx.save(); ctx.translate(0, 48); drawBackground(ctx, 360, 118); ctx.restore();
  ctx.fillStyle = state.fg; ctx.font = `600 18px ${FONT}`; ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, state.title || '', 330), 14, 24);
  return c;
}

// ---------- Vorschau ----------
const stripCtx = $('#strip').getContext('2d');
const faceCtx = $('#face').getContext('2d');
let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const bank = isBank();
    document.body.classList.toggle('look-bank', bank);
    document.body.classList.toggle('look-wallet', !bank);
    const showFace = bank && view === 'card';
    $('#bcard').hidden = !showFace;
    $('#wcard').hidden = showFace;
    $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('#drag-hint').hidden = !img;
    $('#file-label').textContent = img ? 'Anderes Bild auswählen' : 'Bild auswählen';

    if (showFace) {
      drawBankFace(faceCtx, CARD_W, CARD_H, false);
      $('#pv-empty2').hidden = !!img;
      return;
    }
    const card = $('#wcard');
    card.style.setProperty('--c-bg', state.bg);
    card.style.setProperty('--c-fg', state.fg);
    card.style.setProperty('--c-lb', state.lb);
    $('#pv-title').textContent = state.title;
    $('#pv-biglabel').textContent = state.bigLabel;
    $('#pv-big').textContent = state.big;
    $('#pv-primary').hidden = state.burn || bank;
    $('#pv-f1l').textContent = state.f1l; $('#pv-f1v').textContent = state.f1v;
    $('#pv-f2l').textContent = state.f2l; $('#pv-f2v').textContent = state.f2v;
    $('#pv-empty').hidden = !!img;
    drawStrip(stripCtx, { text: state.burn });
    const logo = $('#pv-logo');
    logo.hidden = !img;
    if (img) { const l = logo.getContext('2d'); l.clearRect(0, 0, 90, 90); l.drawImage(squareCrop(90), 0, 0); }

    let qrOk = qrUsable();
    if (qrOk) {
      try { qrCanvas($('#pv-qr'), state.qr, 420); }
      catch { qrOk = false; toast('Der QR-Inhalt ist zu lang – bitte kürzen.'); }
    }
    $('#pv-code').hidden = !qrOk;
    $('#pv-qrtext').textContent = state.qrText;
  });
}

// ---------- Bild laden ----------
async function setImage(src) {
  img = src ? await loadImg(src) : null;
  render();
}

async function downscale(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    const s = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = canvas(Math.round(im.naturalWidth * s), Math.round(im.naturalHeight * s)), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .9);
  } finally { URL.revokeObjectURL(url); }
}

$('#file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = await downscale(f);
    Object.assign(state, { img: data, zoom: 1, ox: 0, oy: 0 });
    $('#zoom').value = 1;
    await setImage(data);
    save();
    toast('Bild drin – jetzt passend schieben.');
  } catch { toast('Das Bild konnte nicht geladen werden. Probier ein anderes.'); }
});

// ---------- Schieben & Zoomen direkt auf der Karte ----------
const activeDims = () => (isBank() && view === 'card' ? [CARD_W, CARD_H] : [STRIP_W, STRIP_H]);
function setZoom(z) {
  const old = state.zoom;
  state.zoom = clamp(z, 1, 4);
  state.ox *= state.zoom / old; state.oy *= state.zoom / old;
  clampOffset(...activeDims());
  $('#zoom').value = state.zoom;
}

function attachDrag(el) {
  const pts = new Map();
  let gesture = null;
  const info = () => {
    const p = [...pts.values()];
    if (p.length === 1) return { x: p[0].x, y: p[0].y, d: 0 };
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
  };
  el.addEventListener('pointerdown', e => {
    if (!img) return;
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture = info();
  });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !img) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = info(), rw = el.getBoundingClientRect().width;
    if (gesture.d && g.d) setZoom(state.zoom * g.d / gesture.d);
    state.ox += (g.x - gesture.x) / rw; state.oy += (g.y - gesture.y) / rw;
    clampOffset(...activeDims());
    gesture = g;
    render();
  });
  const end = e => {
    if (!pts.delete(e.pointerId)) return;
    gesture = pts.size ? info() : null;
    save();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', () => { if (!img) $('#file').click(); });
  el.addEventListener('wheel', e => {
    if (!img) return;
    e.preventDefault();
    setZoom(state.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    render(); save();
  }, { passive: false });
}
attachDrag($('.w-strip'));
attachDrag($('#bcard'));

$$('#views button').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; render(); }));

// ---------- Eingaben ----------
const TEXT_IDS = ['title', 'holder', 'last4', 'bigLabel', 'big', 'f1l', 'f1v', 'f2l', 'f2v', 'qr', 'qrText', 'bg', 'fg', 'lb'];
const CHECK_IDS = ['qrOn', 'burn', 'chip', 'nfc', 'showNum'];
for (const id of TEXT_IDS) $('#' + id).addEventListener('input', e => {
  if (id === 'last4') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  state[id] = e.target.value; markTheme(); render(); save();
});
for (const id of CHECK_IDS) $('#' + id).addEventListener('change', e => { state[id] = e.target.checked; render(); save(); });
$('#zoom').addEventListener('input', e => { setZoom(+e.target.value); render(); save(); });
for (const id of ['bright', 'shade']) $('#' + id).addEventListener('input', e => { state[id] = +e.target.value; render(); save(); });
$('#center').addEventListener('click', () => { state.ox = state.oy = 0; setZoom(1); render(); save(); });

function chipRow(el, list, key) {
  for (const [id, name] of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name; b.dataset.id = id;
    b.addEventListener('click', () => { state[key] = id; markChips(); render(); save(); });
    el.appendChild(b);
  }
}
chipRow($('#filters'), FILTERS, 'filter');
chipRow($('#effects'), EFFECTS, 'fx');
$$('#look button').forEach(b => b.addEventListener('click', () => {
  state.look = b.dataset.look; view = 'card';
  clampOffset(...activeDims()); markChips(); render(); save();
}));
function markChips() {
  $$('#filters button').forEach(b => b.classList.toggle('on', b.dataset.id === state.filter));
  $$('#effects button').forEach(b => b.classList.toggle('on', b.dataset.id === state.fx));
  $$('#look button').forEach(b => b.classList.toggle('on', b.dataset.look === state.look));
}

function fillInputs() {
  for (const id of TEXT_IDS) $('#' + id).value = state[id] ?? '';
  for (const id of CHECK_IDS) $('#' + id).checked = !!state[id];
  for (const id of ['zoom', 'bright', 'shade']) $('#' + id).value = state[id];
  markTheme(); markChips();
}

const themesEl = $('#themes');
for (const t of THEMES) {
  const b = document.createElement('button');
  b.style.background = t.bg; b.style.setProperty('--sw-fg', t.fg);
  b.setAttribute('aria-label', 'Farbschema');
  b.addEventListener('click', () => { Object.assign(state, t); fillInputs(); render(); save(); });
  themesEl.appendChild(b);
}
function markTheme() {
  [...themesEl.children].forEach((b, i) => {
    const t = THEMES[i];
    b.classList.toggle('on', t.bg === state.bg && t.fg === state.fg && t.lb === state.lb);
  });
}

// ---------- Schritte ----------
function go(n) {
  $$('#steps button').forEach(b => b.classList.toggle('on', +b.dataset.step === n));
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== String(n); });
  $('#stage').hidden = n === 3 || n === 'cards';
  $('#cards-btn').classList.toggle('on', n === 'cards');
  if (n === 3) buildOutputs();
  if (n === 'cards') buildCardList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('#steps button').forEach(b => b.addEventListener('click', () => go(+b.dataset.step)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(+b.dataset.go)));
$('#cards-btn').addEventListener('click', () => go($('[data-panel="cards"]').hidden ? 'cards' : 1));

$$('#guide-tabs button').forEach(b => b.addEventListener('click', () => {
  $$('#guide-tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('[data-guide]').forEach(g => { g.hidden = g.dataset.guide !== b.dataset.tab; });
}));

// ---------- Meine Karten ----------
async function openCard(c, step = 1) {
  await flush();
  state = c; view = 'card';
  try { localStorage.setItem(CUR_KEY, c.id); } catch { /* egal */ }
  fillInputs();
  await setImage(state.img).catch(() => { state.img = null; img = null; render(); });
  go(step);
}

function buildCardList() {
  if (saveT) saveNow();            // aktuelles Vorschaubild auffrischen
  const list = $('#cardlist');
  list.innerHTML = '';
  const sorted = [...cards].sort((a, b) => b.updated - a.updated);
  for (const c of sorted) {
    const el = document.createElement('div');
    el.className = 'ci' + (c === state ? ' cur' : '');
    el.innerHTML = '<button class="ci-open"><img alt=""><div><b></b><small></small></div></button>'
      + '<div class="ci-acts"><button data-act="dup">Kopie</button><button data-act="del" class="del">Löschen</button></div>';
    const im = el.querySelector('img');
    if (c.thumb) im.src = c.thumb; else im.hidden = true;
    el.querySelector('b').textContent = c.title || 'Ohne Namen';
    el.querySelector('small').textContent = (c === state ? 'Gerade offen · ' : '') + (c.look === 'bank' ? 'Bankkarten-Look' : 'Kundenkarte')
      + ' · ' + new Date(c.updated).toLocaleDateString('de-DE');
    el.querySelector('.ci-open').addEventListener('click', () => openCard(c));
    el.querySelector('[data-act="dup"]').addEventListener('click', async () => {
      await flush();
      const copy = { ...c, id: uid(), created: Date.now(), updated: Date.now() };
      cards.push(copy);
      await store.put(copy).catch(() => {});
      toast('Kopie angelegt.');
      buildCardList();
    });
    el.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!confirm(`„${c.title || 'Karte'}“ wirklich löschen?`)) return;
      cards = cards.filter(x => x !== c);
      await store.del(c.id).catch(() => {});
      if (c === state) {
        clearTimeout(saveT); saveT = 0;
        if (!cards.length) { const n = newCard(); cards.push(n); await store.put(n).catch(() => {}); }
        const next = [...cards].sort((a, b) => b.updated - a.updated)[0];
        state = next; try { localStorage.setItem(CUR_KEY, next.id); } catch { /* egal */ }
        fillInputs(); await setImage(state.img).catch(() => {});
      }
      buildCardList();
    });
    list.appendChild(el);
  }
}
$('#new-card').addEventListener('click', async () => {
  await flush();
  const c = newCard();
  cards.push(c);
  await store.put(c).catch(() => {});
  openCard(c);
  toast('Neue Karte – wähl ein Bild aus.');
});

// ---------- Export ----------
function cardCanvas() {
  const qrOk = qrUsable();
  const qrH = qrOk ? (8 + 8 + 128 + (state.qrText ? 15 : 0) + 8 + 18) : 18;
  const H = (50 + 123 + 58 + qrH) * PT, W = STRIP_W;
  const c = canvas(W, H), ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, W, H, 14 * PT); ctx.clip();
  ctx.fillStyle = state.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  // Kopf
  let tx = 14 * PT;
  if (img) {
    ctx.save(); roundRect(ctx, tx, 10 * PT, 30 * PT, 30 * PT, 7 * PT); ctx.clip();
    ctx.drawImage(squareCrop(30 * PT), tx, 10 * PT); ctx.restore();
    tx += 39 * PT;
  }
  ctx.fillStyle = state.fg; ctx.font = font(600, 19);
  ctx.fillText(fitText(ctx, state.title, W - tx - 14 * PT), tx, 25 * PT);
  // Banner
  ctx.save(); ctx.translate(0, 50 * PT); drawStrip(ctx, { text: true }); ctx.restore();
  // Felder
  const fy = (50 + 123 + 10) * PT, half = W / 2 - 19 * PT;
  ctx.textBaseline = 'top';
  const field = (label, value, right) => {
    ctx.textAlign = right ? 'right' : 'left';
    const x = right ? W - 14 * PT : 14 * PT;
    ctx.fillStyle = state.lb; ctx.font = font(600, 11);
    ctx.fillText(fitText(ctx, (label || '').toUpperCase(), half), x, fy);
    ctx.fillStyle = state.fg; ctx.font = font(400, 17);
    ctx.fillText(fitText(ctx, value || '', half), x, fy + 16 * PT);
  };
  field(state.f1l, state.f1v, false);
  field(state.f2l, state.f2v, true);
  ctx.textAlign = 'left';
  // QR
  if (qrOk) {
    const boxH = (8 + 128 + (state.qrText ? 15 : 0) + 8) * PT, boxW = 144 * PT;
    const bx = (W - boxW) / 2, by = (50 + 123 + 58 + 8) * PT;
    ctx.fillStyle = '#fff'; roundRect(ctx, bx, by, boxW, boxH, 6 * PT); ctx.fill();
    try {
      const q = qrCanvas(canvas(1, 1), state.qr, 128 * PT);
      ctx.imageSmoothingEnabled = false;
      const qs = 128 * PT;
      ctx.drawImage(q, bx + 8 * PT, by + 8 * PT, qs, qs);
    } catch { /* zu lang – Feld bleibt leer */ }
    if (state.qrText) {
      ctx.fillStyle = '#000'; ctx.font = font(400, 11); ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, state.qrText, 128 * PT), W / 2, by + (8 + 128 + 4) * PT);
      ctx.textAlign = 'left';
    }
  }
  return c;
}

function buildOutputs() {
  const bank = isBank();
  const strip = canvas(STRIP_W, STRIP_H); drawStrip(strip.getContext('2d'), { text: state.burn });
  const wallet = cardCanvas();
  const items = [
    { name: 'Banner', size: '1125 × 369', file: 'syntix-banner.png', c: strip, wide: true,
      note: bank ? 'Das Hauptbild für Wallet – mit Chip, Nummer und Name.' : 'Das Hauptbild der Karte (Strip).' },
    ...(bank ? [{ name: 'Kartenbild', size: CARD_W + ' × ' + CARD_H, file: 'syntix-kartenbild.png', c: bankCardCanvas(), wide: true,
      note: 'Die ganze Karte als Bild – zum Zeigen, Teilen oder als Hintergrund.' }] : []),
    { name: 'Logo', size: '150 × 150', file: 'syntix-logo.png', c: squareCrop(150, 30) },
    { name: 'Icon', size: '180 × 180', file: 'syntix-icon.png', c: squareCrop(180) },
    { name: 'So sieht es in Wallet aus', size: '1125 × ' + wallet.height, file: 'syntix-wallet-vorschau.png', c: wallet, wide: true,
      note: 'Nur zum Ansehen – nicht in Wallet einfügen.' },
  ];
  const out = $('#outputs');
  out.innerHTML = '';
  for (const it of items) {
    const url = it.c.toDataURL('image/png');
    const el = document.createElement('div');
    el.className = 'out' + (it.wide ? ' wide' : '');
    el.innerHTML = `<div class="img"><img alt=""></div><div class="meta"><b></b><span></span></div><p class="onote" hidden></p><div class="acts"><button class="share" hidden>Sichern</button><a download>Als Datei laden</a></div>`;
    el.querySelector('img').src = url;
    el.querySelector('b').textContent = it.name;
    el.querySelector('span').textContent = it.size + ' px';
    if (it.note) { const n = el.querySelector('.onote'); n.textContent = it.note; n.hidden = false; }
    const a = el.querySelector('a'); a.href = url; a.download = it.file;
    // Über HTTPS: iOS-Teilen-Menü mit „Bild sichern“
    const sh = el.querySelector('.share');
    it.c.toBlob(blob => {
      const f = blob && new File([blob], it.file, { type: 'image/png' });
      if (!f || !navigator.canShare || !navigator.canShare({ files: [f] })) return;
      sh.hidden = false;
      sh.onclick = () => navigator.share({ files: [f] }).catch(() => {});
    }, 'image/png');
    out.appendChild(el);
  }
  if (!img) toast('Tipp: Erst ein eigenes Bild einfügen (Schritt 1).');

  const copies = [
    ['Kartenname', state.title],
    ...(bank ? [] : [['Kleine Zeile', state.bigLabel], ['Großer Text', state.big]]),
    [state.f1l || 'Feld 1', state.f1v], [state.f2l || 'Feld 2', state.f2v],
    ['QR-Inhalt', qrUsable() ? state.qr : ''], ['Text unter dem Code', qrUsable() ? state.qrText : ''],
    ['Farbe Hintergrund', state.bg, true], ['Farbe Text', state.fg, true], ['Farbe Titel', state.lb, true],
  ].filter(([, v]) => v && String(v).trim());
  const list = $('#copies');
  list.innerHTML = '';
  for (const [label, value, isColor] of copies) {
    const row = document.createElement('div');
    row.className = 'copy';
    row.innerHTML = '<div><small></small><span></span></div><button>Kopieren</button>';
    row.querySelector('small').textContent = label;
    const span = row.querySelector('span');
    if (isColor) { const d = document.createElement('i'); d.className = 'dot'; d.style.background = value; span.appendChild(d); }
    span.appendChild(document.createTextNode(isColor ? value.toUpperCase() : value));
    const btn = row.querySelector('button');
    btn.addEventListener('click', async () => {
      const ok = await copyText(isColor ? value.toUpperCase() : value);
      btn.textContent = ok ? 'Kopiert' : 'Ging nicht';
      btn.classList.toggle('done', ok);
      setTimeout(() => { btn.textContent = 'Kopieren'; btn.classList.remove('done'); }, 1500);
    });
    list.appendChild(row);
  }
  $('#g-bg').textContent = state.bg.toUpperCase();
}

// Kopieren – über http (WLAN) gibt es navigator.clipboard nicht, daher der alte Weg als Ersatz
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Ersatz unten */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// ---------- Start ----------
// Offline-Modus (nur über HTTPS, also in der Online-Version)
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
$('#version').textContent = APP_VERSION;
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

(async function start() {
  try { await store.open(); } catch { store.db = null; }
  if (!store.db) toast('Speichern geht hier nicht (privater Modus?) – Karten bleiben nur bis zum Schließen.');
  try { cards = (await store.all()) || []; } catch { cards = []; }

  // Einmalig: Karte aus Version 1.0 (localStorage) übernehmen
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch { /* egal */ }
  if (old && typeof old === 'object') {
    const c = newCard({ ...old, look: 'wallet', filter: 'none', fx: 'none',
      ox: (old.ox || 0) / STRIP_W, oy: (old.oy || 0) / STRIP_W });
    cards.push(c);
    try { await store.put(c); if (store.db) localStorage.removeItem(OLD_KEY); } catch { /* bleibt für nächstes Mal */ }
    try { localStorage.setItem(CUR_KEY, c.id); } catch { /* egal */ }
  }
  if (!cards.length) { const c = newCard(); cards.push(c); await store.put(c).catch(() => {}); }

  let cur = null;
  try { cur = localStorage.getItem(CUR_KEY); } catch { /* egal */ }
  const first = cards.find(c => c.id === cur) || [...cards].sort((a, b) => b.updated - a.updated)[0];
  // Felder aus neueren Versionen ergänzen
  cards.forEach(c => { for (const k in DEFAULTS) if (!(k in c)) c[k] = DEFAULTS[k]; });
  await openCard(first);
})();
