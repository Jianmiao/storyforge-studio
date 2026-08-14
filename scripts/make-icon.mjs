#!/usr/bin/env node
/**
 * 生成 Tauri 图标（本地程序化合成，无外部素材）：
 * - src-tauri/icons/icon.ico（32px + 256px PNG 内嵌，Windows 资源用）
 * - src-tauri/icons/icon.png（256px）
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = join(root, "src-tauri", "icons");
mkdirSync(iconDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** 图标像素：对角渐变 + 中央播放三角。 */
function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = (x + y) / (2 * size);
      // 深蓝 → 紫渐变
      px[i] = Math.round(30 + (124 - 30) * t);
      px[i + 1] = Math.round(45 + (92 - 45) * t);
      px[i + 2] = Math.round(80 + (255 - 80) * t);
      px[i + 3] = 255;
    }
  }
  // 播放三角（白色）
  const tri = [
    [0.42, 0.34, 0.42, 0.66, 0.66, 0.5],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const fy = y / size;
      const [ax, ay, bx, by, cx2, cy2] = tri[0];
      if (pointInTri(fx, fy, ax, ay, bx, by, cx2, cy2)) {
        const i = (y * size + x) * 4;
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
      }
    }
  }
  return px;
}

function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (p1x, p1y, p2x, p2y, p3x, p3y) =>
    (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// 生成 256px PNG + 32px PNG → ICO（PNG 内嵌，Vista+ 支持）
const png256 = encodePng(256, makeIcon(256));
const png32 = encodePng(32, makeIcon(32));

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const img of images) {
    const entry = Buffer.alloc(16);
    const size = img.size;
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // colors
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += img.data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const ico = buildIco([
  { size: 256, data: png256 },
  { size: 32, data: png32 },
]);

writeFileSync(join(iconDir, "icon.ico"), ico);
writeFileSync(join(iconDir, "icon.png"), png256);
writeFileSync(join(iconDir, "32x32.png"), png32);
console.log(`图标已生成到 ${iconDir}`);
