/**
 * SceneDescriptor —— Rust 时间轴求值器（studio-core::timeline）的输出契约。
 * 预览（PixiJS）与离线合成（compositor）都消费该描述；两端不得各自实现求值。
 * Rust 侧序列化对应：crates/studio-core/src/timeline.rs（serde 同名结构）。
 */

export interface LayerDescriptor {
  /** 片段 id（选中/调试用）。 */
  id: string;
  kind: "image";
  assetId: string;
  /** 中心点（画布坐标系，原点左上；已含 clip 变换与动作）。 */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** 度。 */
  rotation: number;
  opacity: number;
  /** RGB 颜色乘法。 */
  tint: [number, number, number];
  /** 模糊半径（px）。 */
  blur: number;
  /** 0..1 比例裁剪。 */
  crop: { left: number; right: number; top: number; bottom: number };
  flipX: boolean;
  /** 0..1 白闪强度（flashWhite 动作）。 */
  flash: number;
}

export interface SubtitleDescriptor {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  outlineWidth: number;
  opacity: number;
}

export type EffectDescriptorType = "vignette" | "flash" | "shake" | "tint" | "blur" | "transition";

export interface EffectDescriptor {
  type: EffectDescriptorType;
  /** 已按关键帧求值的参数。 */
  params: Record<string, number | string | number[]>;
}

export interface AudioDescriptor {
  assetId: string;
  /** 片段起点（全局帧）。 */
  startFrame: number;
  /** 片段时长（帧）。 */
  durationFrames: number;
  /** 当前帧音量（0..1，已含关键帧与淡入淡出包络）。 */
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}

export interface SceneDescriptor {
  frame: number;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  /** 相机变换（含 shake 偏移，已求值）。 */
  camera: { x: number; y: number; zoom: number };
  /** 按合成顺序排列（后绘制在上）。 */
  layers: LayerDescriptor[];
  subtitles: SubtitleDescriptor[];
  effects: EffectDescriptor[];
  audio: AudioDescriptor[];
}
