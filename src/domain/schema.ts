import type { Clip, ClipType, Scene, StudioProject, TrackKind } from "./types";

/** 剧本节点类型（v2）。 */
const GRAPH_NODE_TYPES = ["entry", "script", "selection", "exit"];

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

  if (doc.formatVersion !== 2) errors.push(`formatVersion 应为 2，实际 ${doc.formatVersion}`);
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
    validateScene(scene, assetIds, sceneIds, errors);
  }

  // ---- 剧本节点图校验 ----
  validateScriptGraph(doc, assetIds, errors);

  const e = doc.export;
  if (!e || !(e.width > 0) || !(e.height > 0) || !(e.fps >= 1)) errors.push("export 配置非法");
  return errors;
}

function validateScriptGraph(doc: StudioProject, assetIds: Set<string>, errors: string[]): void {
  const graph = doc.script;
  if (!graph || !Array.isArray(graph.nodes)) {
    errors.push("script 剧本图缺失");
    return;
  }
  const ids = new Set<string>();
  const entries: string[] = [];
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`剧本节点 id 重复: ${node.id}`);
    ids.add(node.id);
    if (!GRAPH_NODE_TYPES.includes(node.type)) errors.push(`剧本节点类型非法: ${node.type}`);
    if (node.type === "entry") entries.push(node.id);
    if (!Array.isArray(node.next)) errors.push(`剧本节点 ${node.id} 缺少 next`);
    if (node.type === "selection" && node.options && node.options.length !== node.next.length) {
      errors.push(`选择节点 ${node.id} 的选项数(${node.options.length})与连接数(${node.next.length})不一致`);
    }
    for (const target of node.next ?? []) {
      if (!ids.has(target) && !graph.nodes.some((n) => n.id === target)) {
        errors.push(`剧本节点 ${node.id} 连接到不存在的节点 ${target}`);
      }
    }
    if (node.type === "script" && node.lines) {
      for (const line of node.lines) {
        if (typeof line.clubName !== "string") errors.push(`演出行 ${line.id} clubName 必须是字符串`);
        if (!(line.durationFrames > 0)) errors.push(`演出行 ${line.id} 时长非法`);
        if (line.bgAssetId && !assetIds.has(line.bgAssetId)) {
          errors.push(`演出行 ${line.id} 引用不存在的背景素材 ${line.bgAssetId}`);
        }
        for (const ch of line.characters) {
          if (!assetIds.has(ch.assetId)) {
            errors.push(`演出行 ${line.id} 引用不存在的角色素材 ${ch.assetId}`);
          }
          for (const [name, value] of [["startSlot", ch.startSlot], ["endSlot", ch.endSlot]] as const) {
            if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 6)) {
              errors.push(`演出行 ${line.id} 的 ${name} 必须是 1..6`);
            }
          }
          if (ch.moveDurationFrames !== undefined && !(ch.moveDurationFrames > 0)) {
            errors.push(`演出行 ${line.id} 的 moveDurationFrames 必须大于 0`);
          }
          if (ch.luminance !== undefined && !(ch.luminance >= 0 && ch.luminance <= 1)) {
            errors.push(`演出行 ${line.id} 的 luminance 必须在 0..1`);
          }
        }
      }
    }
  }
  if (graph.entryNodeId) {
    if (!ids.has(graph.entryNodeId)) errors.push(`剧本入口指向不存在的节点 ${graph.entryNodeId}`);
  } else if (entries.length > 0) {
    errors.push("存在 entry 节点但未设置剧本入口");
  }
  if (entries.length > 1) errors.push(`剧本入口节点多于一个（${entries.length}）`);
}

function validateScene(
  scene: Scene,
  assetIds: Set<string>,
  sceneIds: Set<string>,
  errors: string[],
): void {
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
