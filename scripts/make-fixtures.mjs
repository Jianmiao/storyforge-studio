#!/usr/bin/env node
/**
 * 生成 e2e 测试夹具：纯色 PNG、带透明通道角色 PNG、正弦 WAV。
 * 全部本地合成，无第三方素材。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "e2e", "fixtures");
mkdirSync(outDir, { recursive: true });

// ---------- PNG 编码（最小实现） ----------
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

/** 编码 RGBA 像素为 PNG。 */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 每行前置 filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- 夹具 1：背景（渐变近似，64×36） ----------
{
  const w = 64, h = 36;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const i = (y * w + x) * 4;
      px[i] = Math.round(36 + (106 - 36) * t);
      px[i + 1] = Math.round(52 + (90 - 52) * t);
      px[i + 2] = Math.round(71 + (205 - 71) * t);
      px[i + 3] = 255;
    }
  }
  writeFileSync(join(outDir, "fixture-bg.png"), encodePng(w, h, px));
}

// ---------- 夹具 2：角色（透明背景，48×72） ----------
{
  const w = 48, h = 72;
  const px = Buffer.alloc(w * h * 4);
  const cx = w / 2, cy = h * 0.3, r = w * 0.18;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const inBody = x >= 0.28 * w && x <= 0.72 * w && y >= 0.44 * h && y <= 0.94 * h;
      if (d <= r) {
        px[i] = 142; px[i + 1] = 202; px[i + 2] = 230; px[i + 3] = 255;
      } else if (inBody) {
        px[i] = 33; px[i + 1] = 158; px[i + 2] = 188; px[i + 3] = 255;
      } else {
        px[i + 3] = 0;
      }
    }
  }
  writeFileSync(join(outDir, "fixture-char.png"), encodePng(w, h, px));
}

// ---------- 夹具 3：正弦 WAV（880Hz，1 秒） ----------
{
  const sampleRate = 44100;
  const n = sampleRate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const v = Math.sin(2 * Math.PI * 880 * t) * 0.6;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(join(outDir, "fixture-tone.wav"), Buffer.concat([header, data]));
}

console.log(`夹具已生成到 ${outDir}`);
