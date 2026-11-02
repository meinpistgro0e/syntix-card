// Syntix Card – kleiner QR-Code-Generator ohne Abhängigkeiten.
// Byte-Modus (UTF-8), Fehlerkorrektur M, Version 1–10 (bis ca. 213 Bytes).
// QR.matrix(text) -> Array von Zeilen mit true (dunkel) / false (hell).
(function (root) {
  // [EC-Codewörter je Block, [[Anzahl Blöcke, Datenwörter je Block], ...]]
  const EC_M = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // Galois-Feld GF(256)
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function rsGenerator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  }
  function rsRemainder(data, n) {
    const g = rsGenerator(n), r = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ r.shift();
      r.push(0);
      for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f);
    }
    return r;
  }

  const dataWords = v => EC_M[v][1].reduce((s, [n, k]) => s + n * k, 0);

  function encodeData(bytes) {
    let v = 1;
    for (; v <= 10; v++) {
      const ccBits = v < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataWords(v) * 8) break;
    }
    if (v > 10) throw new Error('Der Text ist zu lang für den QR-Code.');
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0b0100, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const cap = dataWords(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; words.length < dataWords(v); p++) words.push(p % 2 ? 0x11 : 0xec);

    // In Blöcke teilen, Fehlerkorrektur anhängen, verschachteln
    const [ecLen, groups] = EC_M[v];
    const blocks = [];
    let pos = 0;
    for (const [n, k] of groups) for (let i = 0; i < n; i++) { const d = words.slice(pos, pos + k); pos += k; blocks.push({ d, e: rsRemainder(d, ecLen) }); }
    const out = [];
    const maxK = Math.max(...blocks.map(b => b.d.length));
    for (let i = 0; i < maxK; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
    return { v, words: out };
  }

  function build(v, words, mask) {
    const size = 17 + 4 * v;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

    // Finder + Trennlinien
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
    // Timing
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // Ausrichtung
    const al = ALIGN[v];
    for (const ay of al) for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ay === 6 && ax === al[al.length - 1])) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Format-Bereiche reservieren (werden unten richtig gesetzt)
    for (let i = 0; i < 9; i++) { set(8, i, false); set(i, 8, false); }
    for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
    // Versionsinfo
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const bits = (v << 12) | r;
      for (let i = 0; i < 18; i++) {
        const b = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
        set(a, c, b); set(c, a, b);
      }
    }

    // Daten im Zickzack
    let bit = 0;
    const total = words.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        m[y][x] = bit < total ? ((words[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1 : false;
        bit++;
      }
    }

    // Maske
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];

    // Formatinfo (Level M = 00)
    const data = (0b00 << 3) | mask;
    let r = data;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((data << 10) | r) ^ 0x5412;
    const fb = i => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, fb(i));
    set(8, 7, fb(6)); set(8, 8, fb(7)); set(7, 8, fb(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i));
    set(8, size - 8, true);
    return m;
  }

  function penalty(m) {
    const n = m.length;
    let p = 0, dark = 0;
    const line = get => {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && get(i) === get(i - 1)) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      for (let i = 0; i + 11 <= n; i++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i + k) ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') p += 40;
      }
    };
    for (let y = 0; y < n; y++) { line(x => m[y][x]); line(x => m[x][y]); }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    for (const row of m) for (const c of row) if (c) dark++;
    p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return p;
  }

  function matrix(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const { v, words } = encodeData(bytes);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(v, words, mask), p = penalty(m);
      if (p < bestP) { bestP = p; best = m; }
    }
    return best;
  }

  // Zeichnet den Code auf einen Canvas-Kontext (ohne Ruhezone).
  function draw(ctx, text, x, y, size, color = '#000') {
    const m = matrix(text), n = m.length, s = size / n;
    ctx.fillStyle = color;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (m[r][c]) ctx.fillRect(x + Math.floor(c * s), y + Math.floor(r * s), Math.ceil(s), Math.ceil(s));
    }
    return n;
  }

  const QR = { matrix, draw };
  if (typeof module !== 'undefined') module.exports = QR;
  else root.QR = QR;
})(this);
