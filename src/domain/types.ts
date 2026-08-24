/**
 * StoryForge Studio — 领域模型（Project Core），v2：节点式剧情编辑。
 * v2 新增 `script` 剧本节点图（参考经典剧情节点图范式：Entry → Script → Selection → Exit，
 * 设计独立实现）：节点为权威剧本，时间轴（scenes）降级为兼容/检查视图。
 * 本文件是权威 TS 定义；Rust 侧对应 crates/studio-core/src/model.rs。
 * 契约文档：docs/PROJECT_FORMAT.md。
 */

/** 当前项目格式版本。 */
export const FORMAT_VERSION = 2;

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
// 缓动与关键帧（保留：演出行内过渡/动作使用；时间轴兼容模式使用）
// ---------------------------------------------------------------------------

export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut" | "cubic";

export interface Easing {
  type: EasingType;
  c1?: [number, number];
  c2?: [number, number];
}

export interface Keyframe {
  frame: number;
  path: string;
  value: number | string;
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

export const ACTION_ENTER_DURATION = 15;
export const ACTION_EXIT_DURATION = 15;

// ---------------------------------------------------------------------------
// 剧本节点图（v2 核心）
// ---------------------------------------------------------------------------

export type GraphNodeType = "entry" | "script" | "selection" | "exit";

/** 演出行中的角色引用（槽位 + 动作 + 摆放）。 */
export interface CharacterLineRef {
  assetId: string;
  /** 旧工程三槽：0 = 左，1 = 中，2 = 右。 */
  slot: number;
  /** 待机动作：none | sway | shake | jump | pulse | flashWhite。 */
  action: string;
  /** 缩放（1 = 原尺寸）。 */
  scale: number;
  /** AA 语义五槽（1..5）；缺失时继续按旧三槽解释 slot。 */
  startSlot?: number;
  endSlot?: number;
  /** 进入/退出可见性语义。 */
  appear?: "none" | "fadeIn" | "fadeOut" | "hide" | "move";
  /** 移动时长与缓动；缺失时为 0.5 秒 easeInOut。 */
  moveDurationFrames?: number;
  moveEasing?: EasingType;
  /** 演出状态。false 使用 AA 的 0.6 待机亮度。 */
  highlighted?: boolean;
  luminance?: number;
  onTop?: boolean;
  closeup?: boolean;
  /** 保留给适配器解析资源形态，不参与素材寻址。 */
  faceId?: string;
  shapeOverride?: string;
}

/** 演出行：一条完整演出指令（台词 + 背景 + 角色 + 音频 + 转场）。 */
export interface ScriptLine {
  id: string;
  /** 台词 / 演出文本。 */
  text: string;
  /** 说话人显示名。 */
  speaker: string;
  /** 说话人所属社团/组织显示名（AA 姓名牌的蓝色副标题）。 */
  clubName: string;
  /** 该行在场角色（按槽位摆放，可多个）。 */
  characters: CharacterLineRef[];
  /** 背景素材；null = 保持上一行。 */
  bgAssetId: string | null;
  /** 背景特效：none | blur。 */
  bgEffect: string;
  /** BGM 素材；null = 保持。 */
  bgmAssetId: string | null;
  /** 语音素材；null = 无。 */
  voiceAssetId: string | null;
  /** 音效素材；null = 无。 */
  soundAssetId: string | null;
  /** 转场：none | fade。 */
  transition: string;
  /** 该行持续帧数（播放/导出按帧求值）。 */
  durationFrames: number;
  /** 地点文本（场景说明，可选）。 */
  placeText: string;
}

/** 运行时鉴赏画面的结构化对白。 */
export interface PresentationDialogue {
  id: string;
  text: string;
  speaker: string;
  clubName: string;
  placeText: string;
  x: number;
  nameY: number;
  bodyY: number;
  fontSize: number;
  opacity: number;
  outlineWidth: number;
}

/** 剧本节点（节点图成员；可选字段按 type 生效，与 AA 节点数据模型的职责划分一致）。 */
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  /** 画布坐标（节点图布局）。 */
  x: number;
  y: number;
  title: string;
  /** entry：标题下的小标题。 */
  header?: string;
  /** exit：结局文本。 */
  endText?: string;
  /** script：有序演出行。 */
  lines?: ScriptLine[];
  /** selection：选项文本，与 next 索引对齐（第 i 个选项 → next[i]）。 */
  options?: string[];
  /** 输出连接（目标节点 id）：entry/script 0..1；selection 0..N；exit 0。 */
  next: string[];
}

/** 剧本图。 */
export interface ScriptGraph {
  nodes: GraphNode[];
  /** 演出起点（entry 节点 id）。 */
  entryNodeId: string | null;
}

// ---------------------------------------------------------------------------
// 时间轴兼容结构（v1 遗留；仅回退求值使用，v2 新项目不产生）
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

export type ClipType = "image" | "subtitle" | "audio" | "camera" | "effect";

export interface CropRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface VisualProps {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  tint: [number, number, number];
  blur: number;
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

interface ClipBase {
  id: string;
  type: ClipType;
  name: string;
  start: number;
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
  /** 剧本节点图（v2 权威剧本）。 */
  script: ScriptGraph;
  /** v1 遗留时间轴（迁移保留；v2 新项目为空数组）。 */
  scenes: Scene[];
  export: ExportConfig;
}

export function defaultProject(name: string): StudioProject {
  const now = new Date().toISOString();
  const entryId = "nd_entry";
  const exitId = "nd_exit";
  return {
    formatVersion: FORMAT_VERSION,
    meta: { name, createdAt: now, updatedAt: now },
    canvas: { width: 1920, height: 1080, fps: 30 },
    assets: [],
    script: {
      entryNodeId: entryId,
      nodes: [
        { id: entryId, type: "entry", x: 60, y: 240, title: "开场", header: "剧本开始", next: ["nd_script1"] },
        {
          id: "nd_script1",
          type: "script",
          x: 340,
          y: 240,
          title: "第一场",
          next: [exitId],
          lines: [
            {
              id: "ln_1",
              text: "在这里编写第一句台词。",
              speaker: "",
              clubName: "",
              characters: [],
              bgAssetId: null,
              bgEffect: "none",
              bgmAssetId: null,
              voiceAssetId: null,
              soundAssetId: null,
              transition: "none",
              durationFrames: 30 * 5,
              placeText: "",
            },
          ],
        },
        { id: exitId, type: "exit", x: 620, y: 240, title: "结束", endText: "全剧终", next: [] },
      ],
    },
    scenes: [],
    export: {
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "h264",
      crf: 18,
      preset: "veryfast",
      audioBitrateKbps: 192,
    },
  };
}

// ---------------------------------------------------------------------------
// 查找辅助（纯函数）
// ---------------------------------------------------------------------------

export function findGraphNode(graph: ScriptGraph, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

export function findScriptLine(node: GraphNode, lineId: string): ScriptLine | undefined {
  return node.lines?.find((l) => l.id === lineId);
}

export function findAsset(project: StudioProject, assetId: string): AssetRecord | undefined {
  return project.assets.find((a) => a.id === assetId);
}

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
