// Generates the PWA icons (PNG) with zero dependencies by writing the
// PNG format directly: full-bleed brand background + white chat bubble.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../apps/dashboard/public/icons");
mkdirSync(OUT_DIR, { recursive: true });

const BRAND = [37, 99, 235]; // #2563eb
const WHITE = [255, 255, 255];

// CRC32 (PNG chunk checksums)
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- shape tests (in unit coordinates 0..1) ---
function inRoundRect(x, y, rx, ry, rw, rh, rad) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  if ((x >= rx + rad && x <= rx + rw - rad) || (y >= ry + rad && y <= ry + rh - rad)) return true;
  const cx = x < rx + rad ? rx + rad : rx + rw - rad;
  const cy = y < ry + rad ? ry + rad : ry + rh - rad;
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2;
}
function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const s = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const t = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const u = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
}

// Color at a unit-square point: brand background, white bubble + tail,
// brand dots inside the bubble.
function colorAt(x, y) {
  const bubble =
    inRoundRect(x, y, 0.2, 0.24, 0.6, 0.38, 0.1) ||
    inTriangle(x, y, [0.3, 0.6], [0.46, 0.6], [0.3, 0.74]);
  if (bubble) {
    const dotR = 0.042;
    if (
      inCircle(x, y, 0.35, 0.43, dotR) ||
      inCircle(x, y, 0.5, 0.43, dotR) ||
      inCircle(x, y, 0.65, 0.43, dotR)
    ) {
      return BRAND;
    }
    return WHITE;
  }
  return BRAND;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling factor for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const [cr, cg, cb] = colorAt(x, y);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = 255;
    }
  }
  return encodePng(size, pixels);
}

for (const size of [180, 192, 512]) {
  const png = renderIcon(size);
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
