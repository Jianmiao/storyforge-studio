import type { Clip, ClipType, StudioProject, TrackKind } from "./types";

/** 允许的 轨道种类 ↔ 片段类型 组合。 */
export const TRACK_KIND_TO_CLIP_TYPES: Record<TrackKind, ClipType[]> = {
  background: ["image"],
  character: ["image"],
  camera: ["camera"],
  subtitle: ["subtitle"],
  bgm: ["audio"],
  voice: ["audio"],
  sfx: ["audio"],
  effect: ["effect"],
};

const TRACK_KINDS: TrackKind[] = [
  "background",
  "character",
  "camera",
  "subtitle",
  "bgm",
  "voice",
  "sfx",
  "effect",
];

const CLIP_TYPES: ClipType[] = ["image", "subtitle", "audio", "camera", "effect"];

const NUMERIC_CLIP_PATHS = new Set([
  "props.x",
  "props.y",
  "props.scaleX",
  "props.scaleY",
  "props.rotation",
  "props.opacity",
  "props.blur",
  "props.crop.left",
  "props.crop.right",
  "props.crop.top",
  "props.crop.bottom",
  "x",
  "y",
  "fontSize",
  "opacity",
  "outlineWidth",
  "volume",
  "fadeInFrames",
  "fadeOutFrames",
  "zoom",
  "strength",
  "softness",
  "alpha",
  "amplitude",
  "frequency",
  "amount",
  "radius",
]);

const DISCRETE_CLIP_PATHS = new Set(["assetId", "props.flipX", "align"]);

/**
 * 项目结构校验。返回错误列表；空数组 = 合法。
 * 不修改任何内容；打开项目时用于提示，测试时用于断言。
 */
export function validateProject(doc: StudioProject): string[] {
  const errors: string[] = [];

  if (doc.formatVersion !== 1) errors.push(`formatVersion 应为 1，实际 ${doc.formatVersion}`);
  if (typeof doc.meta?.name !== "string") errors.push("meta.name 缺失");
  const c = doc.canvas;
  if (!c || !(c.width > 0) || !(c.height > 0)) errors.push("canvas 尺寸非法");
  if (!c || !(c.fps >= 1 && c.fps <= 120)) errors.push(`canvas.fps 非法: ${c?.fps}`);

  const assetIds = new Set<string>();
  for (const a of doc.assets) {
    if (assetIds.has(a.id)) errors.push(`素材 id 重复: ${a.id}`);
    assetIds.add(a.id);
    if (a.kind !== "image" && a.kind !== "audio") errors.push(`素材 ${a.id} kind 非法`);
    if (typeof a.fileName !== "string" || a.fileName.length === 0) errors.push(`素材 ${a.id} fileName 缺失`);
    if (typeof a.hash !== "string" || a.hash.length === 0) errors.push(`素材 ${a.id} hash 缺失`);
  }

  const sceneIds = new Set<string>();
  for (const scene of doc.scenes) {
    if (sceneIds.has(scene.id)) errors.push(`场景 id 重复: ${scene.id}`);
    sceneIds.add(scene.id);
    if (!(scene.durationFrames > 0)) errors.push(`场景 ${scene.id} durationFrames 非法`);
    const trackIds = new Set<string>();
    for (const track of scene.tracks) {
      if (!TRACK_KINDS.includes(track.kind)) errors.push(`轨道 ${track.id} kind 非法: ${track.kind}`);
      if (trackIds.has(track.id)) errors.push(`轨道 id 重复: ${track.id}`);
      trackIds.add(track.id);
      const clipIds = new Set<string>();
      for (const clip of track.clips) {
        if (clipIds.has(clip.id)) errors.push(`片段 id 重复: ${clip.id}`);
        clipIds.add(clip.id);
        validateClip(clip, track.kind, assetIds, errors);
      }
    }
  }

  const e = doc.export;
  if (!e || !(e.width > 0) || !(e.height > 0) || !(e.fps >= 1)) errors.push("export 配置非法");
  return errors;
}

function validateClip(
  clip: Clip,
  trackKind: TrackKind,
  assetIds: Set<string>,
  errors: string[],
): void {
  if (!CLIP_TYPES.includes(clip.type)) errors.push(`片段 ${clip.id} type 非法: ${clip.type}`);
  const allowed = TRACK_KIND_TO_CLIP_TYPES[trackKind] ?? [];
  if (!allowed.includes(clip.type)) {
    errors.push(`片段 ${clip.id} 类型 ${clip.type} 不允许放在 ${trackKind} 轨道`);
  }
  if (!(clip.start >= 0)) errors.push(`片段 ${clip.id} start 非法`);
  if (!(clip.duration > 0)) errors.push(`片段 ${clip.id} duration 非法`);
  if (clip.type === "image" || clip.type === "audio") {
    if (typeof clip.assetId !== "string" || !assetIds.has(clip.assetId)) {
      errors.push(`片段 ${clip.id} 引用不存在的素材 ${clip.assetId}`);
    }
  }
  let prevFrameByPath = new Map<string, number>();
  for (const kf of clip.keyframes) {
    if (kf.frame < 0) errors.push(`片段 ${clip.id} 关键帧帧号非法`);
    const prev = prevFrameByPath.get(kf.path);
    if (prev !== undefined && kf.frame < prev) {
      errors.push(`片段 ${clip.id} 关键帧未按帧号排序（${kf.path}）`);
    }
    prevFrameByPath.set(kf.path, kf.frame);
    if (typeof kf.path !== "string" || kf.path.length === 0) errors.push(`片段 ${clip.id} 关键帧路径非法`);
    if (typeof kf.value === "number" && !Number.isFinite(kf.value)) errors.push(`片段 ${clip.id} 关键帧数值非法`);
    if (!kf.easing || typeof kf.easing.type !== "string") errors.push(`片段 ${clip.id} 关键帧缓动非法`);
  }
}

/** 关键帧路径是否合法（用于属性面板的增删关键帧按钮）。 */
export function isKeyframeablePath(clip: Clip, path: string): boolean {
  if (NUMERIC_CLIP_PATHS.has(path) || DISCRETE_CLIP_PATHS.has(path)) return true;
  // 特效参数
  if (clip.type === "effect" && path.startsWith("effect.params.")) return true;
  return false;
}
