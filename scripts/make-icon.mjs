#!/usr/bin/env node
// Draws the extension icon (icon.png, 256x256): a ledger page with a check mark. Original artwork, no Qoyod branding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SIZE = 256;
const SS = 4; // supersampling per axis

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

function shade(x, y) {
  // returns [r, g, b, a] for one sample
  if (!inRoundRect(x, y, 8, 8, 248, 248, 52)) return [0, 0, 0, 0];
  const t = y / SIZE;
  let color = [Math.round(20 + 6 * t), Math.round(128 - 40 * t), Math.round(124 - 36 * t), 255]; // teal gradient
  if (inRoundRect(x, y, 62, 40, 178, 214, 14)) color = [255, 255, 255, 255]; // page
  const lines = [[84, 78, 156], [84, 104, 156], [84, 130, 156], [84, 156, 124]];
  for (const [lx0, ly, lx1] of lines) if (inRoundRect(x, y, lx0, ly, lx1, ly + 10, 5)) color = [22, 110, 106, 255];
  if ((x - 178) ** 2 + (y - 184) ** 2 <= 38 * 38) color = [245, 158, 11, 255]; // amber badge
  const check = Math.min(distToSegment(x, y, 160, 184, 173, 198), distToSegment(x, y, 173, 198, 197, 170));
  if ((x - 178) ** 2 + (y - 184) ** 2 <= 38 * 38 && check <= 5) color = [255, 255, 255, 255];
  return color;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [cr, cg, cb, ca] = shade(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
        r += cr * ca;
        g += cg * ca;
        b += cb * ca;
        a += ca;
      }
    }
    const i = (py * SIZE + px) * 4;
    rgba[i] = a ? Math.round(r / a) : 0;
    rgba[i + 1] = a ? Math.round(g / a) : 0;
    rgba[i + 2] = a ? Math.round(b / a) : 0;
    rgba[i + 3] = Math.round(a / (SS * SS));
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'icon.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
