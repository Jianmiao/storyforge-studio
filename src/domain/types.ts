/**
 * StoryForge Studio — 领域模型（Project Core）。
 * 本文件是 StudioProject v1 的权威 TS 定义；Rust 侧对应 crates/studio-core/src/model.rs。
 * 契约文档：docs/PROJECT_FORMAT.md。
 * 本模块不依赖 React / Tauri / PixiJS，保持纯领域。
 */

/** 当前项目格式版本。 */
export const FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// 基础
// ---------------------------------------------------------------------------

export interface CanvasConfig {
  width: number;
  height: number;
  fps: number;
}

// ---------------------------------------------------------------------------
// 素材
// ---------------------------------------------------------------------------

export type AssetKind = "image" | "audio";

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  /** assets/ 目录内的文件名（= <hash16>.<ext>）。 */
  fileName: string;
  /** 导入时的原始路径，仅作参考（缺失提示用）。 */
  originalPath: string;
  /** 内容 SHA-256（hex）。 */
  hash: string;
  /** 图像素材：像素尺寸。 */
  width?: number;
  height?: number;
  /** 音频素材：时长（毫秒）。 */
  durationMs?: number;
  /** 打开项目时由后端校验；不参与编辑语义。 */
  missing?: boolean;
}

// ---------------------------------------------------------------------------
// 缓动与关键帧
// ---------------------------------------------------------------------------

export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut" | "cubic";

export interface Easing {
  type: EasingType;
  /** 仅 type === "cubic"：贝塞尔控制点（相对 0..1 单位正方形）。 */
  c1?: [number, number];
  c2?: [number, number];
}

export interface Keyframe {
  /** 片段内局部帧号（0-based）。 */
  frame: number;
  /** 点分属性路径，如 "x"、"opacity"、"crop.left"、"assetId"。 */
  path: string;
  /** 数值属性为 number；离散属性（assetId）为 string。 */
  value: number | string;
  /** 控制从上一个关键帧插值到本关键帧的缓动。 */
  easing: Easing;
}

// ---------------------------------------------------------------------------
// 动作（通用角色动作）
// ---------------------------------------------------------------------------

export type EnterAction = "none" | "fadeIn" | "slideInLeft" | "slideInRight" | "zoomIn";
export type IdleAction = "none" | "sway" | "shake" | "jump" | "pulse" | "flashWhite";
export type ExitAction = "none" | "fadeOut" | "slideOutLeft" | "slideOutRight" | "zoomOut";

export interface Actions {
  enter: EnterAction;
  idle: IdleAction;
  exit: ExitAction;
}

export const ACTION_ENTER_DURATION = 15; // 帧
export const ACTION_EXIT_DURATION = 15; // 帧

// ---------------------------------------------------------------------------
// 视觉属性
// ---------------------------------------------------------------------------

export interface CropRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface VisualProps {
  /** 中心点（画布坐标系，原点左上）。 */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** 度。 */
  rotation: number;
  /** 0..1 */
  opacity: number;
  /** RGB 颜色乘法。 */
  tint: [number, number, number];
  /** 模糊半径（px）。 */
  blur: number;
  /** 0..1 比例裁剪。 */
  crop: CropRect;
  flipX: boolean;
}

export function defaultVisualProps(overrides?: Partial<VisualProps>): VisualProps {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    tint: [255, 255, 255],
    blur: 0,
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    flipX: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 片段
// ---------------------------------------------------------------------------

export type ClipType = "image" | "subtitle" | "audio" | "camera" | "effect";

interface ClipBase {
  id: string;
  type: ClipType;
  name: string;
  /** 片段内局部帧号起点。 */
  start: number;
  /** 帧数（区间 [start, start+duration)）。 */
  duration: number;
  keyframes: Keyframe[];
}

export interface ImageClip extends ClipBase {
  type: "image";
  assetId: string;
  props: VisualProps;
  actions: Actions;
}

export interface SubtitleClip extends ClipBase {
  type: "subtitle";
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  outlineWidth: number;
  opacity: number;
}

export interface AudioClip extends ClipBase {
  type: "audio";
  assetId: string;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}

export interface CameraClip extends ClipBase {
  type: "camera";
  props: { x: number; y: number; zoom: number };
}

export type EffectType = "vignette" | "flash" | "shake" | "tint" | "blur" | "transition";

export interface EffectClip extends ClipBase {
  type: "effect";
  effect: { type: EffectType; params: Record<string, number | string | number[]> };
}

export type Clip = ImageClip | SubtitleClip | AudioClip | CameraClip | EffectClip;

// ---------------------------------------------------------------------------
// 轨道 / 场景
// ---------------------------------------------------------------------------

export type TrackKind =
  | "background"
  | "character"
  | "camera"
  | "subtitle"
  | "bgm"
  | "voice"
  | "sfx"
  | "effect";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  clips: Clip[];
}

export interface Scene {
  id: string;
  name: string;
  durationFrames: number;
  tracks: Track[];
}

// ---------------------------------------------------------------------------
// 导出配置
// ---------------------------------------------------------------------------

export interface ExportConfig {
  width: number;
  height: number;
  fps: number;
  videoCodec: "h264";
  crf: number;
  preset: string;
  audioBitrateKbps: number;
}

// ---------------------------------------------------------------------------
// 项目
// ---------------------------------------------------------------------------

export interface StudioProject {
  formatVersion: number;
  meta: { name: string; createdAt: string; updatedAt: string };
  canvas: CanvasConfig;
  assets: AssetRecord[];
  scenes: Scene[];
  export: ExportConfig;
}

export function defaultProject(name: string): StudioProject {
  const now = new Date().toISOString();
  const sceneId = "scn_1";
  const trackId = (kind: TrackKind, i: number) => `trk_${kind}_${i}`;
  return {
    formatVersion: FORMAT_VERSION,
    meta: { name, createdAt: now, updatedAt: now },
    canvas: { width: 1920, height: 1080, fps: 30 },
    assets: [],
    scenes: [
      {
        id: sceneId,
        name: "场景 1",
        durationFrames: 30 * 30, // 30 秒
        tracks: [
          { id: trackId("background", 0), kind: "background", name: "背景", muted: false, clips: [] },
          { id: trackId("character", 0), kind: "character", name: "角色", muted: false, clips: [] },
          { id: trackId("camera", 0), kind: "camera", name: "镜头", muted: false, clips: [] },
          { id: trackId("subtitle", 0), kind: "subtitle", name: "字幕", muted: false, clips: [] },
          { id: trackId("bgm", 0), kind: "bgm", name: "BGM", muted: false, clips: [] },
          { id: trackId("voice", 0), kind: "voice", name: "语音", muted: false, clips: [] },
          { id: trackId("sfx", 0), kind: "sfx", name: "音效", muted: false, clips: [] },
          { id: trackId("effect", 0), kind: "effect", name: "特效", muted: false, clips: [] },
        ],
      },
    ],
    export: { width: 1920, height: 1080, fps: 30, videoCodec: "h264", crf: 18, preset: "veryfast", audioBitrateKbps: 192 },
  };
}

// ---------------------------------------------------------------------------
// 查找辅助（纯函数）
// ---------------------------------------------------------------------------

export function findTrack(scene: Scene, trackId: string): Track | undefined {
  return scene.tracks.find((t) => t.id === trackId);
}

export function findClipInScene(scene: Scene, clipId: string): { track: Track; clip: Clip; index: number } | undefined {
  for (const track of scene.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return undefined;
}

export function findAsset(project: StudioProject, assetId: string): AssetRecord | undefined {
  return project.assets.find((a) => a.id === assetId);
}
