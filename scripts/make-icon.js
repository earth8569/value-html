/* Generates assets/icon.png and assets/icon.ico (a tiny colored graph) without any dependencies. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const px = Buffer.alloc(SIZE * SIZE * 4);

const nodes = [
  { x: 84, y: 92, r: 24, c: [245, 158, 11] },
  { x: 172, y: 78, r: 19, c: [167, 139, 250] },
  { x: 126, y: 164, r: 27, c: [52, 211, 153] },
  { x: 192, y: 172, r: 17, c: [244, 114, 182] },
];
const edges = [[0, 1], [0, 2], [1, 2], [2, 3], [1, 3]];

const smooth = (edge0, edge1, x) => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function segDist(px_, py_, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.min(1, Math.max(0, ((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy));
}
function roundedRectSdf(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const bg = roundedRectSdf(x + 0.5, y + 0.5, SIZE, SIZE, 52);
    const a = 1 - smooth(-1, 1, bg);
    const g = (x + y) / (2 * SIZE);
    let col = [mix(40, 22, g), mix(44, 24, g), mix(72, 29, g)];
    // edges
    for (const [p, q] of edges) {
      const d = segDist(x + 0.5, y + 0.5, nodes[p].x, nodes[p].y, nodes[q].x, nodes[q].y);
      const t = 1 - smooth(2.2, 3.6, d);
      col = col.map((c, k) => mix(c, [157, 135, 255][k], t * 0.85));
    }
    // nodes
    for (const n of nodes) {
      const d = Math.hypot(x + 0.5 - n.x, y + 0.5 - n.y);
      const t = 1 - smooth(n.r - 1, n.r + 1, d);
      col = col.map((c, k) => mix(c, n.c[k], t));
    }
    px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = Math.round(a * 255);
  }
}

/* ---- PNG encoder ---- */
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) { raw[y * (SIZE * 4 + 1)] = 0; px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

/* ---- ICO wrapper (PNG-compressed 256x256 entry) ---- */
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0; head[8] = 0; head[9] = 0;       // 0 means 256
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, png]));
console.log('wrote assets/icon.png and assets/icon.ico', png.length, 'bytes');
