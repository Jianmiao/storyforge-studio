import { newClipId } from "./id";
import { defaultVisualProps } from "./types";
import type {
  AssetRecord,
  Clip,
  ClipType,
  Easing,
  Keyframe,
  Scene,
  StudioProject,
  Track,
  TrackKind,
  Actions,
} from "./types";

/**
 * 命令模式：所有对项目文档的修改都必须是 Command 实例，
 * 通过 store.executeCommand 提交（apply），通过 History 撤销（undo）。
 * 命令不持有 React 状态，只操作项目文档（immer draft 与文档同构）。
 */

export type ProjectDraft = StudioProject;

export interface Command {
  readonly name: string;
  apply(draft: ProjectDraft): void;
  undo(draft: ProjectDraft): void;
  /**
   * 与栈顶命令合并（如连续拖动同一属性）。
   * 实现：更新自身撤销信息并返回 true；调用方不再入栈。
   * 前提：next 的 apply 已完成。
   */
  merge?(next: Command): boolean;
}

// ---------------------------------------------------------------------------
// 工具：点分路径 get/set（clip 领域属性）
// ---------------------------------------------------------------------------

export function getClipProp(clip: Clip, path: string): unknown {
  let cur: unknown = clip;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function setClipProp(clip: Clip, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: Record<string, unknown> = clip as unknown as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = cur[segs[i]];
    if (!next || typeof next !== "object") {
      throw new Error(`setClipProp: 路径 ${path} 中断于 ${segs[i]}`);
    }
    cur = next as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

function findClip(scene: Scene, clipId: string): Clip | undefined {
  for (const t of scene.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) return c;
  }
  return undefined;
}

function findTrack(scene: Scene, trackId: string): Track | undefined {
  return scene.tracks.find((t) => t.id === trackId);
}

function findScene(doc: ProjectDraft, sceneId: string): Scene | undefined {
  return doc.scenes.find((s) => s.id === sceneId);
}

// ---------------------------------------------------------------------------
// 素材命令
// ---------------------------------------------------------------------------

export class AddAssetCommand implements Command {
  readonly name = "添加素材";
  constructor(private readonly asset: AssetRecord) {}
  apply(d: ProjectDraft) {
    d.assets.push(this.asset);
  }
  undo(d: ProjectDraft) {
    d.assets = d.assets.filter((a) => a.id !== this.asset.id);
  }
}

export class RemoveAssetCommand implements Command {
  readonly name = "删除素材";
  private index = -1;
  constructor(private readonly asset: AssetRecord) {}
  apply(d: ProjectDraft) {
    this.index = d.assets.findIndex((a) => a.id === this.asset.id);
    if (this.index >= 0) d.assets.splice(this.index, 1);
  }
  undo(d: ProjectDraft) {
    if (this.index >= 0) {
      d.assets.splice(this.index, 0, this.asset);
    }
  }
}

export class RelocateAssetCommand implements Command {
  readonly name = "重新定位素材";
  constructor(
    private readonly assetId: string,
    private readonly oldFileName: string,
    private readonly oldOriginalPath: string,
    private readonly newFileName: string,
    private readonly newOriginalPath: string,
  ) {}
  apply(d: ProjectDraft) {
    const a = d.assets.find((x) => x.id === this.assetId);
    if (a) {
      a.fileName = this.newFileName;
      a.originalPath = this.newOriginalPath;
      a.missing = false;
    }
  }
  undo(d: ProjectDraft) {
    const a = d.assets.find((x) => x.id === this.assetId);
    if (a) {
      a.fileName = this.oldFileName;
      a.originalPath = this.oldOriginalPath;
      a.missing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// 场景命令
// ---------------------------------------------------------------------------

export class AddSceneCommand implements Command {
  readonly name = "添加场景";
  constructor(private readonly scene: Scene, private readonly index: number) {}
  apply(d: ProjectDraft) {
    d.scenes.splice(this.index, 0, this.scene);
  }
  undo(d: ProjectDraft) {
    d.scenes = d.scenes.filter((s) => s.id !== this.scene.id);
  }
}

export class RemoveSceneCommand implements Command {
  readonly name = "删除场景";
  private index = -1;
  constructor(private readonly scene: Scene) {}
  apply(d: ProjectDraft) {
    this.index = d.scenes.findIndex((s) => s.id === this.scene.id);
    if (this.index >= 0) d.scenes.splice(this.index, 1);
  }
  undo(d: ProjectDraft) {
    if (this.index >= 0) d.scenes.splice(this.index, 0, this.scene);
  }
}

export class RenameSceneCommand implements Command {
  readonly name = "重命名场景";
  constructor(
    private readonly sceneId: string,
    private readonly oldName: string,
    private readonly newName: string,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) s.name = this.newName;
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) s.name = this.oldName;
  }
}

export class SetSceneDurationCommand implements Command {
  readonly name = "设置场景时长";
  constructor(
    private readonly sceneId: string,
    private readonly oldDuration: number,
    private readonly newDuration: number,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) s.durationFrames = this.newDuration;
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) s.durationFrames = this.oldDuration;
  }
}

// ---------------------------------------------------------------------------
// 轨道命令
// ---------------------------------------------------------------------------

export class AddTrackCommand implements Command {
  readonly name = "添加轨道";
  constructor(
    private readonly sceneId: string,
    private readonly track: Track,
    private readonly index: number,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) s.tracks.splice(this.index, 0, this.track);
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) s.tracks = s.tracks.filter((t) => t.id !== this.track.id);
  }
}

export class RemoveTrackCommand implements Command {
  readonly name = "删除轨道";
  private index = -1;
  constructor(private readonly sceneId: string, private readonly track: Track) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s) {
      this.index = s.tracks.findIndex((t) => t.id === this.track.id);
      if (this.index >= 0) s.tracks.splice(this.index, 1);
    }
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    if (s && this.index >= 0) s.tracks.splice(this.index, 0, this.track);
  }
}

// ---------------------------------------------------------------------------
// 片段命令
// ---------------------------------------------------------------------------

export class AddClipCommand implements Command {
  readonly name = "添加片段";
  constructor(
    private readonly sceneId: string,
    private readonly trackId: string,
    private readonly clip: Clip,
    private readonly index: number,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const t = s && findTrack(s, this.trackId);
    if (t) t.clips.splice(this.index, 0, this.clip);
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const t = s && findTrack(s, this.trackId);
    if (t) t.clips = t.clips.filter((c) => c.id !== this.clip.id);
  }
}

export class RemoveClipCommand implements Command {
  readonly name = "删除片段";
  private index = -1;
  constructor(private readonly sceneId: string, private readonly trackId: string, private readonly clip: Clip) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const t = s && findTrack(s, this.trackId);
    if (t) {
      this.index = t.clips.findIndex((c) => c.id === this.clip.id);
      if (this.index >= 0) t.clips.splice(this.index, 1);
    }
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const t = s && findTrack(s, this.trackId);
    if (t && this.index >= 0) t.clips.splice(this.index, 0, this.clip);
  }
}

export class MoveClipCommand implements Command {
  readonly name = "移动片段";
  private toStart: number;
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly fromStart: number,
    toStart: number,
  ) {
    this.toStart = toStart;
  }
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) c.start = Math.max(0, this.toStart);
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) c.start = this.fromStart;
  }
  merge(next: Command): boolean {
    if (!(next instanceof MoveClipCommand)) return false;
    if (next.sceneId !== this.sceneId || next.clipId !== this.clipId) return false;
    this.toStart = next.toStart;
    return true;
  }
}

export class TrimClipCommand implements Command {
  readonly name = "裁剪片段";
  private newStart: number;
  private newDuration: number;
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly oldStart: number,
    private readonly oldDuration: number,
    newStart: number,
    newDuration: number,
  ) {
    this.newStart = newStart;
    this.newDuration = newDuration;
  }
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      c.start = Math.max(0, this.newStart);
      c.duration = Math.max(1, this.newDuration);
    }
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      c.start = this.oldStart;
      c.duration = this.oldDuration;
    }
  }
  merge(next: Command): boolean {
    if (!(next instanceof TrimClipCommand)) return false;
    if (next.sceneId !== this.sceneId || next.clipId !== this.clipId) return false;
    this.newStart = next.newStart;
    this.newDuration = next.newDuration;
    return true;
  }
}

export class SetClipPropsCommand implements Command {
  readonly name = "设置属性";
  private newValue: unknown;
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly path: string,
    private readonly oldValue: unknown,
    newValue: unknown,
  ) {
    this.newValue = newValue;
  }
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) setClipProp(c, this.path, this.newValue);
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) setClipProp(c, this.path, this.oldValue);
  }
  merge(next: Command): boolean {
    if (!(next instanceof SetClipPropsCommand)) return false;
    if (next.sceneId !== this.sceneId || next.clipId !== this.clipId || next.path !== this.path) return false;
    this.newValue = next.newValue;
    return true;
  }
}

export class SetSubtitleTextCommand implements Command {
  readonly name = "编辑字幕";
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly oldText: string,
    private readonly newText: string,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c && c.type === "subtitle") c.text = this.newText;
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c && c.type === "subtitle") c.text = this.oldText;
  }
}

export class SetActionsCommand implements Command {
  readonly name = "设置动作";
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly oldActions: unknown,
    private readonly newActions: unknown,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c && c.type === "image") c.actions = this.newActions as Actions;
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c && c.type === "image") c.actions = this.oldActions as Actions;
  }
}

export class SetEffectCommand implements Command {
  readonly name = "设置特效";
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly oldEffect: unknown,
    private readonly newEffect: unknown,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c && c.type === "effect") c.effect = this.newEffect as typeof c.effect;
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c && c.type === "effect") c.effect = this.oldEffect as typeof c.effect;
  }
}

// ---------------------------------------------------------------------------
// 关键帧命令
// ---------------------------------------------------------------------------

export class AddKeyframeCommand implements Command {
  readonly name = "添加关键帧";
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly keyframe: Keyframe,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      c.keyframes.push(this.keyframe);
      c.keyframes.sort((a, b) => a.frame - b.frame);
    }
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      c.keyframes = c.keyframes.filter(
        (k) => !(k.frame === this.keyframe.frame && k.path === this.keyframe.path),
      );
    }
  }
}

export class RemoveKeyframeCommand implements Command {
  readonly name = "删除关键帧";
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly keyframe: Keyframe,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      c.keyframes = c.keyframes.filter(
        (k) => !(k.frame === this.keyframe.frame && k.path === this.keyframe.path),
      );
    }
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      c.keyframes.push(this.keyframe);
      c.keyframes.sort((a, b) => a.frame - b.frame);
    }
  }
}

export class UpdateKeyframeCommand implements Command {
  readonly name = "修改关键帧";
  constructor(
    private readonly sceneId: string,
    private readonly clipId: string,
    private readonly oldKf: Keyframe,
    private readonly newKf: Keyframe,
  ) {}
  apply(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      const idx = c.keyframes.findIndex((k) => k.frame === this.oldKf.frame && k.path === this.oldKf.path);
      if (idx >= 0) c.keyframes[idx] = this.newKf;
      c.keyframes.sort((a, b) => a.frame - b.frame);
    }
  }
  undo(d: ProjectDraft) {
    const s = findScene(d, this.sceneId);
    const c = s && findClip(s, this.clipId);
    if (c) {
      const idx = c.keyframes.findIndex((k) => k.frame === this.newKf.frame && k.path === this.newKf.path);
      if (idx >= 0) c.keyframes[idx] = this.oldKf;
      c.keyframes.sort((a, b) => a.frame - b.frame);
    }
  }
}

// ---------------------------------------------------------------------------
// 项目级命令
// ---------------------------------------------------------------------------

export class SetCanvasCommand implements Command {
  readonly name = "设置画布";
  constructor(
    private readonly oldCanvas: unknown,
    private readonly newCanvas: unknown,
  ) {}
  apply(d: ProjectDraft) {
    d.canvas = this.newCanvas as typeof d.canvas;
  }
  undo(d: ProjectDraft) {
    d.canvas = this.oldCanvas as typeof d.canvas;
  }
}

export class SetExportConfigCommand implements Command {
  readonly name = "设置导出配置";
  constructor(
    private readonly oldExport: unknown,
    private readonly newExport: unknown,
  ) {}
  apply(d: ProjectDraft) {
    d.export = this.newExport as typeof d.export;
  }
  undo(d: ProjectDraft) {
    d.export = this.oldExport as typeof d.export;
  }
}

export class RenameProjectCommand implements Command {
  readonly name = "重命名项目";
  constructor(
    private readonly oldName: string,
    private readonly newName: string,
  ) {}
  apply(d: ProjectDraft) {
    d.meta.name = this.newName;
  }
  undo(d: ProjectDraft) {
    d.meta.name = this.oldName;
  }
}

export class TouchUpdatedAtCommand implements Command {
  readonly name = "更新时间戳";
  constructor(private readonly oldUpdatedAt: string, private readonly newUpdatedAt: string) {}
  apply(d: ProjectDraft) {
    d.meta.updatedAt = this.newUpdatedAt;
  }
  undo(d: ProjectDraft) {
    d.meta.updatedAt = this.oldUpdatedAt;
  }
}

// ---------------------------------------------------------------------------
// 便捷工厂（UI 层使用，封装 id 生成与默认值）
// ---------------------------------------------------------------------------

export interface NewClipOptions {
  sceneId: string;
  trackId: string;
  type: ClipType;
  name?: string;
  start: number;
  duration: number;
  assetId?: string;
  props?: unknown;
  text?: string;
  volume?: number;
}

export function makeClip(opts: NewClipOptions): Clip {
  const base = { start: opts.start, duration: opts.duration, keyframes: [] as Keyframe[] };
  switch (opts.type) {
    case "image":
      return {
        ...base,
        id: newClipId("img"),
        type: "image",
        name: opts.name ?? "图片片段",
        assetId: opts.assetId ?? "",
        props: opts.props ? { ...defaultVisualProps(), ...(opts.props as object) } : defaultVisualProps(),
        actions: { enter: "none", idle: "none", exit: "none" },
      };
    case "subtitle":
      return {
        ...base,
        id: newClipId("sub"),
        type: "subtitle",
        name: opts.name ?? "字幕",
        text: opts.text ?? "字幕文本",
        x: 960,
        y: 940,
        fontSize: 64,
        color: "#ffffff",
        align: "center",
        outlineWidth: 4,
        opacity: 1,
      };
    case "audio":
      return {
        ...base,
        id: newClipId("aud"),
        type: "audio",
        name: opts.name ?? "音频片段",
        assetId: opts.assetId ?? "",
        volume: opts.volume ?? 0.8,
        fadeInFrames: 0,
        fadeOutFrames: 0,
      };
    case "camera":
      return {
        ...base,
        id: newClipId("cam"),
        type: "camera",
        name: opts.name ?? "镜头",
        props: { x: 0, y: 0, zoom: 1 },
      };
    case "effect":
      return {
        ...base,
        id: newClipId("fx"),
        type: "effect",
        name: opts.name ?? "特效片段",
        effect: { type: "vignette", params: { strength: 0.5, softness: 0.6 } },
      };
  }
}

export function trackKindLabel(kind: TrackKind): string {
  const map: Record<TrackKind, string> = {
    background: "背景",
    character: "角色",
    camera: "镜头",
    subtitle: "字幕",
    bgm: "BGM",
    voice: "语音",
    sfx: "音效",
    effect: "特效",
  };
  return map[kind];
}

export function trackKindForClip(clip: Clip): TrackKind {
  switch (clip.type) {
    case "image":
      return "character";
    case "camera":
      return "camera";
    case "subtitle":
      return "subtitle";
    case "audio":
      return "bgm";
    case "effect":
      return "effect";
  }
}

export type { Easing };
