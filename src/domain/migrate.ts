import { FORMAT_VERSION, type StudioProject } from "./types";

/**
 * 项目迁移机制：migrations 注册表（from → to），加载时按链逐级升级。
 * 与 Rust 侧 crates/studio-core/src/migrate.rs 保持同一语义（各自测试 + roundtrip）。
 */

export interface Migration {
  from: number;
  to: number;
  /** 输入旧版本文档（任意 JSON），输出新版本文档（任意 JSON）。 */
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

/**
 * v0（历史测试夹具）→ v1：
 * - 补充 formatVersion: 1
 * - assets[].fileName 由 "assets/xxx.png" 全相对路径改为纯文件名
 * - image clip 的扁平字段 { transform: {position:[x,y], scale:[sx,sy]} } 迁移为 props
 */
const v0ToV1: Migration = {
  from: 0,
  to: 1,
  migrate(raw) {
    const doc = { ...raw, formatVersion: 1 } as Record<string, unknown>;
    const assets = Array.isArray(doc.assets) ? doc.assets : [];
    doc.assets = assets.map((a: Record<string, unknown>) => {
      const fileName = typeof a.fileName === "string" ? a.fileName : "";
      const stripped = fileName.startsWith("assets/")
        ? fileName.slice("assets/".length)
        : fileName.startsWith("assets\\")
          ? fileName.slice("assets\\".length)
          : fileName;
      return { ...a, fileName: stripped };
    });
    const scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
    doc.scenes = scenes.map((scene: Record<string, unknown>) => {
      const tracks = Array.isArray(scene.tracks) ? scene.tracks : [];
      scene.tracks = tracks.map((track: Record<string, unknown>) => {
        const clips = Array.isArray(track.clips) ? track.clips : [];
        track.clips = clips.map((clip: Record<string, unknown>) => {
          if (clip.type !== "image") return clip;
          const transform = (clip.transform ?? {}) as Record<string, unknown>;
          const position = Array.isArray(transform.position) ? transform.position : [0, 0];
          const scale = Array.isArray(transform.scale) ? transform.scale : [1, 1];
          const props = {
            x: typeof position[0] === "number" ? position[0] : 0,
            y: typeof position[1] === "number" ? position[1] : 0,
            scaleX: typeof scale[0] === "number" ? scale[0] : 1,
            scaleY: typeof scale[1] === "number" ? scale[1] : 1,
            rotation: 0,
            opacity: typeof clip.opacity === "number" ? clip.opacity : 1,
            tint: [255, 255, 255],
            blur: 0,
            crop: { left: 0, right: 0, top: 0, bottom: 0 },
            flipX: false,
          };
          const { transform: _t, opacity: _o, ...rest } = clip;
          return { ...rest, props, actions: { enter: "none", idle: "none", exit: "none" } };
        });
        return track;
      });
      return scene;
    });
    return doc;
  },
};

/**
 * v1（时间轴）→ v2（节点式剧本）：
 * - formatVersion: 2
 * - 新增 script 剧本图（空图 + entryNodeId null；scenes 时间轴保留为兼容数据，
 *   求值器对无剧本图的项目回退到时间轴求值 —— 迁移不破坏任何 v1 内容）
 */
const v1ToV2: Migration = {
  from: 1,
  to: 2,
  migrate(raw) {
    const doc = { ...raw, formatVersion: 2 } as Record<string, unknown>;
    if (doc.script === undefined || doc.script === null) {
      doc.script = { nodes: [], entryNodeId: null };
    }
    if (!Array.isArray(doc.scenes)) {
      doc.scenes = [];
    }
    return doc;
  },
};

export const migrations: Migration[] = [v0ToV1, v1ToV2];

export function latestFormatVersion(): number {
  return FORMAT_VERSION;
}

/**
 * 迁移任意输入到当前格式。
 * @throws 结构非法 / 未知更高版本 / 迁移链断裂
 */
export function migrateProject(raw: unknown): StudioProject {
  if (!raw || typeof raw !== "object") {
    throw new Error("项目文件结构非法");
  }
  const first = raw as Record<string, unknown>;
  // v0 历史夹具无 formatVersion 字段：按 v0 处理
  let version = typeof first.formatVersion === "number" ? first.formatVersion : 0;
  if (version > FORMAT_VERSION) {
    throw new Error(`项目格式 v${version} 高于当前支持的 v${FORMAT_VERSION}，请升级应用`);
  }
  let doc = first;
  while (version < FORMAT_VERSION) {
    const m = migrations.find((x) => x.from === version);
    if (!m) {
      throw new Error(`缺少从 v${version} 到 v${version + 1} 的迁移，无法打开该项目`);
    }
    doc = m.migrate(doc);
    version = m.to;
  }
  return doc as unknown as StudioProject;
}
