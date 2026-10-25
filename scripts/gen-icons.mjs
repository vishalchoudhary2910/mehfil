// Generates the Mehfil app icons as raw PNGs — no image dependencies.
// Mark: plum tile, marigold→saffron gradient disc, cream "M" polyline.
// The glyph stays inside the maskable safe zone (<=40% radius), so the same
// artwork serves regular, maskable and apple-touch icons.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(out, { recursive: true });

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const PLUM = [34, 21, 48];
const MARIGOLD = [245, 166, 35];
const SAFFRON = [255, 107, 53];
const CREAM = [251, 246, 238];

const distToSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

// M polyline in unit coords (y down), within the disc.
const M_PTS = [[-0.46, 0.46], [-0.46, -0.46], [0, 0.16], [0.46, -0.46], [0.46, 0.46]];

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const R = size * 0.34;          // disc radius (inside the 40% maskable safe zone)
  const stroke = size * 0.075;    // M stroke width

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const dist = Math.hypot(dx, dy);

      // background: plum with a soft top-left lift
      const lift = Math.max(0, 1 - Math.hypot(dx + c * 0.7, dy + c * 0.7) / (size * 1.1)) * 18;
      let r = PLUM[0] + lift, g = PLUM[1] + lift * 0.7, b = PLUM[2] + lift * 1.1, a = 255;

      // disc, anti-aliased, diagonal marigold→saffron gradient
      const discA = Math.max(0, Math.min(1, R - dist + 0.5));
      if (discA > 0) {
        const t = Math.max(0, Math.min(1, (dx + dy + R * 1.4) / (R * 2.8)));
        const dr = MARIGOLD[0] + (SAFFRON[0] - MARIGOLD[0]) * t;
        const dg = MARIGOLD[1] + (SAFFRON[1] - MARIGOLD[1]) * t;
        const db = MARIGOLD[2] + (SAFFRON[2] - MARIGOLD[2]) * t;
        r = r + (dr - r) * discA;
        g = g + (dg - g) * discA;
        b = b + (db - b) * discA;
      }

      // cream M on top of the disc
      let mDist = Infinity;
      for (let s = 0; s < M_PTS.length - 1; s++) {
        const [x1, y1] = M_PTS[s], [x2, y2] = M_PTS[s + 1];
        mDist = Math.min(mDist, distToSeg(dx, dy, x1 * R, y1 * R, x2 * R, y2 * R));
      }
      const mStroke = stroke * (discA > 0 ? 1 : 0); // M only inside the disc
      const mAlpha = Math.max(0, Math.min(1, mStroke / 2 - mDist + 0.5)) * discA;
      if (mAlpha > 0) {
        r = r + (CREAM[0] - r) * mAlpha;
        g = g + (CREAM[1] - g) * mAlpha;
        b = b + (CREAM[2] - b) * mAlpha;
      }

      px[i] = Math.round(r); px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b); px[i + 3] = a;
    }
  }
  return px;
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const px = render(size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ["icon-512.png", 512],
  ["icon-192.png", 192],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
  ["favicon-16.png", 16],
]) {
  writeFileSync(join(out, name), png(size));
  console.log(`${name} (${size}x${size}) written`);
}
