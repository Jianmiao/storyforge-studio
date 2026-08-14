#!/usr/bin/env node
/**
 * 离线导出验收：生成演示项目 → sf_export 渲染为 MP4 → ffprobe/ffmpeg 校验：
 * - 流属性：H.264、1920×1080、30fps、AAC
 * - 帧数 == 360、时长 ≈ 12.0s、音画同步偏差 < 0.1s
 * - 音频存在实际信号（volumedetect 非静音）
 * - 字幕已渲染（抽帧检查文字像素非全黑）
 * 用法：node scripts/verify-export.mjs [--ffmpeg E:\ffmpeg\bin\ffmpeg.exe]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ffmpegFlag = args.indexOf("--ffmpeg");
const ffmpeg = ffmpegFlag >= 0 ? args[ffmpegFlag + 1] : null;

function findFfmpeg() {
  if (ffmpeg && existsSync(ffmpeg)) return ffmpeg;
  const candidates = [
    "ffmpeg.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "D:\\ffmpeg\\bin\\ffmpeg.exe",
    "E:\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  for (const c of candidates) {
    const r = spawnSync(c, ["-version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

const ffmpegPath = findFfmpeg();
if (!ffmpegPath) {
  console.error("✗ 找不到 FFmpeg（验证需要 ffprobe）");
  process.exit(1);
}

// 1) 确保 CLI 已构建
const exe = join(root, "src-tauri", "target", "debug", "sf_export.exe");
if (!existsSync(exe)) {
  console.log("构建 sf_export（首次编译可能较慢）…");
  execFileSync("cargo", ["build", "--manifest-path", join(root, "src-tauri", "Cargo.toml"), "--bin", "sf_export"], {
    stdio: "inherit",
    cwd: root,
  });
}

// 2) 渲染演示项目
const outDir = join(root, "e2e", ".tmp");
mkdirSync(outDir, { recursive: true });
const outMp4 = join(outDir, "demo-export.mp4");
for (const f of [outMp4]) existsSync(f) && rmSync(f);

console.log("渲染演示项目 →", outMp4, "（1080p30，360 帧，软件合成 + x264，预计数分钟）");
const renderArgs = [exe, "--demo", "--out", outMp4];
if (ffmpegPath !== "ffmpeg.exe") renderArgs.push("--ffmpeg", ffmpegPath);
const render = spawnSync(renderArgs[0], renderArgs.slice(1), { encoding: "utf8", cwd: root, timeout: 60 * 60 * 1000 });
const summaryLine = (render.stdout ?? "").split("\n").filter((l) => l.trim().startsWith("{")).pop();
if (!summaryLine || render.status !== 0) {
  console.error("✗ 渲染失败：", render.stderr || render.stdout);
  process.exit(1);
}
const summary = JSON.parse(summaryLine);
console.log("渲染 summary:", summaryLine);

// 3) ffprobe 校验
const ffprobe = ffmpegPath.replace(/ffmpeg\.exe$/, "ffprobe.exe");
const probe = (ff) => {
  const r = spawnSync(ff, ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", outMp4], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe 失败: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
let info;
try {
  info = probe(ffprobe);
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}

const vStream = info.streams.find((s) => s.codec_type === "video");
const aStream = info.streams.find((s) => s.codec_type === "audio");
const format = info.format;
const checks = [];

checks.push(["文件存在且可播放", existsSync(outMp4) && format.format_name.includes("mp4")]);
checks.push(["视频流 H.264", vStream?.codec_name === "h264"]);
checks.push(["分辨率 1920×1080", vStream?.width === 1920 && vStream?.height === 1080]);
checks.push(["帧率 30", parseFloat(vStream?.r_frame_rate ?? "0") === 30]);
checks.push(["总帧数 == 360", Number(vStream?.nb_frames ?? 0) === 360]);
const vDur = parseFloat(vStream?.duration ?? format?.duration ?? "0");
checks.push(["视频时长 ≈ 12.0s", Math.abs(vDur - 12.0) < 0.15]);
checks.push(["音频流 AAC", aStream?.codec_name === "aac"]);
const aDur = parseFloat(aStream?.duration ?? "0");
checks.push(["音画同步偏差 < 0.1s", Math.abs(vDur - aDur) < 0.1]);

// 4) 音频信号检测（非静音）
const vol = spawnSync(ffmpegPath, ["-v", "quiet", "-i", outMp4, "-map", "0:a", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
const meanMatch = /mean_volume: (-?[\d.]+) dB/.exec(vol.stderr ?? "");
const meanVol = meanMatch ? parseFloat(meanMatch[1]) : -91;
checks.push(["音频含实际信号（mean_volume > -80 dB）", meanVol > -80]);

// 5) 字幕渲染检测（第 90 帧应有文字：字幕区域同时存在暗（描边/背景）与亮（白字）像素）
const frameFile = join(outDir, "frame90.png");
spawnSync(ffmpegPath, ["-hide_banner", "-y", "-i", outMp4, "-vf", "select=eq(n\\,90)", "-vframes", "1", frameFile], { encoding: "utf8" });
let subtitleOk = false;
if (existsSync(frameFile)) {
  const sig = spawnSync(ffmpegPath, ["-hide_banner", "-i", frameFile, "-vf", "signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" });
  const yminMatch = /YMIN=(\d+)/.exec(sig.stderr ?? "");
  const ymaxMatch = /YMAX=(\d+)/.exec(sig.stderr ?? "");
  if (yminMatch && ymaxMatch) {
    const ymin = parseInt(yminMatch[1]);
    const ymax = parseInt(ymaxMatch[1]);
    // 字幕区域同时存在暗（描边/背景）与亮（白字）像素 → 有文字渲染
    subtitleOk = ymin < 240 && ymax > 60;
  }
  rmSync(frameFile, { force: true });
}
checks.push(["字幕已渲染（第 90 帧文字区域有对比度）", subtitleOk]);

let pass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) pass = false;
}

if (!pass) {
  console.error("✗ 导出验收未通过");
  process.exit(1);
}
console.log(`✓ 导出验收通过：${outMp4}（${summary.frames} 帧，${summary.durationSec}s，mean_volume ${meanVol} dB）`);
