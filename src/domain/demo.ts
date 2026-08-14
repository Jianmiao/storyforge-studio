import { FORMAT_VERSION, type AssetRecord, type StudioProject } from "./types";

/**
 * 演示项目文档生成（前端侧，v2 节点式剧本）。
 * 素材文件本体由后端 createDemoProject 生成（Rust 本地合成），
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

/**
 * 节点式演示剧本（默认路径总时长 360 帧 = 12 秒 @30fps）：
 * entry → 开场（背景 + BGM + 角色入场）→ 对话 → selection（两选项）
 * → 分支 A（含音效与闪白）→ exit（默认导出路径 A）
 */
export function buildDemoProject(now: string): StudioProject {
  return {
    formatVersion: FORMAT_VERSION,
    meta: { name: "演示项目", createdAt: now, updatedAt: now },
    canvas: { width: 1920, height: 1080, fps: DEMO_FPS },
    assets: DEMO_ASSETS.map(assetRecord),
    script: {
      entryNodeId: "nd_entry",
      nodes: [
        {
          id: "nd_entry",
          type: "entry",
          x: 60,
          y: 260,
          title: "开场",
          header: "演示剧本",
          next: ["nd_open"],
        },
        {
          id: "nd_open",
          type: "script",
          x: 300,
          y: 260,
          title: "开场演出",
          next: ["nd_dialog"],
          lines: [
            {
              id: "ln_open",
              text: "夜色降临，故事开始。",
              speaker: "",
              characters: [
                { assetId: "ast_char", slot: 1, action: "sway", scale: 1 },
              ],
              bgAssetId: "ast_bg",
              bgEffect: "none",
              bgmAssetId: "ast_bgm",
              voiceAssetId: null,
              soundAssetId: null,
              transition: "fade",
              durationFrames: 120,
              placeText: "小镇广场",
            },
          ],
        },
        {
          id: "nd_dialog",
          type: "script",
          x: 540,
          y: 260,
          title: "第一段对话",
          next: ["nd_choice"],
          lines: [
            {
              id: "ln_d1",
              text: "欢迎来到 StoryForge，旅人。",
              speaker: "领航员",
              characters: [
                { assetId: "ast_char", slot: 1, action: "sway", scale: 1 },
              ],
              bgAssetId: null,
              bgEffect: "none",
              bgmAssetId: null,
              voiceAssetId: null,
              soundAssetId: null,
              transition: "none",
              durationFrames: 120,
              placeText: "",
            },
          ],
        },
        {
          id: "nd_choice",
          type: "selection",
          x: 780,
          y: 260,
          title: "选择",
          next: ["nd_branchA", "nd_branchB"],
          options: ["进入支线剧情", "直接结束"],
        },
        {
          id: "nd_branchA",
          type: "script",
          x: 1020,
          y: 160,
          title: "支线剧情",
          next: ["nd_exit"],
          lines: [
            {
              id: "ln_a1",
              text: "你选择了支线——一道闪光划过夜空。",
              speaker: "领航员",
              characters: [
                { assetId: "ast_char", slot: 1, action: "flashWhite", scale: 1 },
              ],
              bgAssetId: null,
              bgEffect: "blur",
              bgmAssetId: null,
              voiceAssetId: null,
              soundAssetId: "ast_sfx",
              transition: "fade",
              durationFrames: 120,
              placeText: "广场·夜晚",
            },
          ],
        },
        {
          id: "nd_branchB",
          type: "script",
          x: 1020,
          y: 380,
          title: "直接结束",
          next: ["nd_exit"],
          lines: [
            {
              id: "ln_b1",
              text: "你选择了直接结束。故事留待来日。",
              speaker: "领航员",
              characters: [
                { assetId: "ast_char", slot: 1, action: "sway", scale: 1 },
              ],
              bgAssetId: null,
              bgEffect: "none",
              bgmAssetId: null,
              voiceAssetId: null,
              soundAssetId: null,
              transition: "fade",
              durationFrames: 120,
              placeText: "",
            },
          ],
        },
        {
          id: "nd_exit",
          type: "exit",
          x: 1260,
          y: 260,
          title: "结束",
          endText: "全剧终",
          next: [],
        },
      ],
    },
    scenes: [],
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
