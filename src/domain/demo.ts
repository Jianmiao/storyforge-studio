import { FORMAT_VERSION, type AssetRecord, type StudioProject } from "./types";

/**
 * 演示项目文档生成（前端侧）。
 * 素材文件本体由后端 createDemoProject 生成（Rust 本地合成：渐变背景 / 角色剪影 / 正弦 BGM / 提示音），
 * 返回补齐真实元数据（hash / 尺寸 / 时长）的 AssetRecord 列表，前端再合并进文档。
 * mock 后端使用浏览器生成的占位素材。
 */

export const DEMO_ASSETS: Array<{
  id: string;
  kind: "image" | "audio";
  fileName: string;
  width?: number;
  height?: number;
  durationMs?: number;
}> = [
  { id: "ast_bg", kind: "image", fileName: "demo-bg.png", width: 1920, height: 1080 },
  { id: "ast_char", kind: "image", fileName: "demo-char.png", width: 480, height: 720 },
  { id: "ast_bgm", kind: "audio", fileName: "demo-bgm.wav", durationMs: 12000 },
  { id: "ast_sfx", kind: "audio", fileName: "demo-sfx.wav", durationMs: 600 },
];

export const DEMO_FPS = 30;
export const DEMO_DURATION_FRAMES = 360; // 12 秒

function assetRecord(d: (typeof DEMO_ASSETS)[number]): AssetRecord {
  return {
    id: d.id,
    kind: d.kind,
    fileName: d.fileName,
    originalPath: "",
    hash: `demo-${d.fileName}`,
    width: d.width,
    height: d.height,
    durationMs: d.durationMs,
  };
}

/** 生成演示项目文档（素材元数据为占位，由后端补齐）。 */
export function buildDemoProject(now: string): StudioProject {
  const kf = (frame: number, path: string, value: number | string) => ({
    frame,
    path,
    value,
    easing: { type: "linear" as const },
  });
  return {
    formatVersion: FORMAT_VERSION,
    meta: { name: "演示项目", createdAt: now, updatedAt: now },
    canvas: { width: 1920, height: 1080, fps: DEMO_FPS },
    assets: DEMO_ASSETS.map(assetRecord),
    scenes: [
      {
        id: "scn_demo",
        name: "演示场景",
        durationFrames: DEMO_DURATION_FRAMES,
        tracks: [
          {
            id: "trk_background",
            kind: "background",
            name: "背景",
            muted: false,
            clips: [
              {
                id: "clp_bg",
                type: "image",
                name: "渐变背景",
                assetId: "ast_bg",
                start: 0,
                duration: DEMO_DURATION_FRAMES,
                props: {
                  x: 960,
                  y: 540,
                  scaleX: 1,
                  scaleY: 1,
                  rotation: 0,
                  opacity: 1,
                  tint: [255, 255, 255],
                  blur: 0,
                  crop: { left: 0, right: 0, top: 0, bottom: 0 },
                  flipX: false,
                },
                keyframes: [
                  { frame: 0, path: "props.opacity", value: 0, easing: { type: "easeInOut" } },
                  { frame: 30, path: "props.opacity", value: 1, easing: { type: "easeInOut" } },
                  { frame: 330, path: "props.opacity", value: 1, easing: { type: "linear" } },
                  { frame: DEMO_DURATION_FRAMES, path: "props.opacity", value: 0, easing: { type: "easeInOut" } },
                ],
                actions: { enter: "none", idle: "none", exit: "none" },
              },
            ],
          },
          {
            id: "trk_character",
            kind: "character",
            name: "角色",
            muted: false,
            clips: [
              {
                id: "clp_char",
                type: "image",
                name: "角色立绘",
                assetId: "ast_char",
                start: 0,
                duration: DEMO_DURATION_FRAMES,
                props: {
                  x: 960,
                  y: 540,
                  scaleX: 1.1,
                  scaleY: 1.1,
                  rotation: 0,
                  opacity: 1,
                  tint: [255, 255, 255],
                  blur: 0,
                  crop: { left: 0, right: 0, top: 0, bottom: 0 },
                  flipX: false,
                },
                keyframes: [
                  // 入场：从左侧滑入 + 淡入
                  kf(0, "props.x", 300),
                  kf(30, "props.x", 960),
                  kf(0, "props.opacity", 0),
                  kf(30, "props.opacity", 1),
                  // 强调缩放（中段）
                  kf(150, "props.scaleX", 1.1),
                  kf(165, "props.scaleX", 1.2),
                  kf(180, "props.scaleX", 1.1),
                  kf(150, "props.scaleY", 1.1),
                  kf(165, "props.scaleY", 1.2),
                  kf(180, "props.scaleY", 1.1),
                  // 表情切换（换贴图 —— 演示用同素材，后端生成两个变体？MVP：同素材，行为验证由求值测试覆盖）
                  // 出场：向右滑出 + 淡出
                  kf(330, "props.x", 960),
                  kf(DEMO_DURATION_FRAMES, "props.x", 1620),
                  kf(330, "props.opacity", 1),
                  kf(DEMO_DURATION_FRAMES, "props.opacity", 0),
                ],
                actions: { enter: "none", idle: "sway", exit: "none" },
              },
            ],
          },
          {
            id: "trk_camera",
            kind: "camera",
            name: "镜头",
            muted: false,
            clips: [
              {
                id: "clp_cam",
                type: "camera",
                name: "镜头推近",
                start: 0,
                duration: DEMO_DURATION_FRAMES,
                props: { x: 0, y: 0, zoom: 1 },
                keyframes: [
                  kf(0, "zoom", 1),
                  kf(DEMO_DURATION_FRAMES, "zoom", 1.06),
                  kf(0, "x", 0),
                  kf(DEMO_DURATION_FRAMES, "x", 30),
                ],
              },
            ],
          },
          {
            id: "trk_subtitle",
            kind: "subtitle",
            name: "字幕",
            muted: false,
            clips: [
              {
                id: "clp_sub1",
                type: "subtitle",
                name: "台词 1",
                start: 60,
                duration: 120,
                text: "第一段台词：欢迎来到 StoryForge。",
                x: 960,
                y: 940,
                fontSize: 56,
                color: "#ffffff",
                align: "center",
                outlineWidth: 4,
                opacity: 1,
                keyframes: [],
              },
              {
                id: "clp_sub2",
                type: "subtitle",
                name: "台词 2",
                start: 180,
                duration: 120,
                text: "第二段台词：离线渲染验收样例。",
                x: 960,
                y: 940,
                fontSize: 56,
                color: "#ffffff",
                align: "center",
                outlineWidth: 4,
                opacity: 1,
                keyframes: [],
              },
            ],
          },
          {
            id: "trk_bgm",
            kind: "bgm",
            name: "BGM",
            muted: false,
            clips: [
              {
                id: "clp_bgm",
                type: "audio",
                name: "演示 BGM",
                assetId: "ast_bgm",
                start: 0,
                duration: DEMO_DURATION_FRAMES,
                volume: 0.7,
                fadeInFrames: 30,
                fadeOutFrames: 60,
                keyframes: [],
              },
            ],
          },
          {
            id: "trk_voice",
            kind: "voice",
            name: "语音",
            muted: false,
            clips: [
              {
                id: "clp_sfx",
                type: "audio",
                name: "提示音",
                assetId: "ast_sfx",
                start: 60,
                duration: 18,
                volume: 0.9,
                fadeInFrames: 2,
                fadeOutFrames: 6,
                keyframes: [],
              },
            ],
          },
          {
            id: "trk_sfx",
            kind: "sfx",
            name: "音效",
            muted: false,
            clips: [],
          },
          {
            id: "trk_effect",
            kind: "effect",
            name: "特效",
            muted: false,
            clips: [
              {
                id: "clp_vig",
                type: "effect",
                name: "暗角",
                start: 0,
                duration: DEMO_DURATION_FRAMES,
                effect: { type: "vignette", params: { strength: 0.5, softness: 0.7 } },
                keyframes: [],
              },
              {
                id: "clp_flash",
                type: "effect",
                name: "闪白",
                start: 150,
                duration: 15,
                effect: { type: "flash", params: { alpha: 0.9 } },
                keyframes: [
                  kf(0, "effect.params.alpha", 0),
                  kf(6, "effect.params.alpha", 0.9),
                  kf(15, "effect.params.alpha", 0),
                ],
              },
              {
                id: "clp_shake",
                type: "effect",
                name: "震动",
                start: 150,
                duration: 20,
                effect: { type: "shake", params: { amplitude: 8, frequency: 30 } },
                keyframes: [],
              },
              {
                id: "clp_trans",
                type: "effect",
                name: "转场（结尾淡出）",
                start: 330,
                duration: 30,
                effect: { type: "transition", params: { color: "#000000", alpha: 0 } },
                keyframes: [
                  kf(0, "effect.params.alpha", 0),
                  kf(30, "effect.params.alpha", 1),
                ],
              },
            ],
          },
        ],
      },
    ],
    export: {
      width: 1920,
      height: 1080,
      fps: DEMO_FPS,
      videoCodec: "h264",
      crf: 18,
      preset: "veryfast",
      audioBitrateKbps: 192,
    },
  };
}
