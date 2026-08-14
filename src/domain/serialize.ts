import type { StudioProject } from "./types";

/** 序列化：UTF-8 JSON（无 BOM）。写入端（Rust）保证编码。 */
export function serializeProject(doc: StudioProject): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** 解析 + 基础结构校验。 */
export function parseProject(json: string): StudioProject {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`项目文件不是合法 JSON: ${(e as Error).message}`);
  }
  const doc = raw as StudioProject;
  if (!doc || typeof doc !== "object") throw new Error("项目文件结构非法");
  if (typeof doc.formatVersion !== "number") throw new Error("项目文件缺少 formatVersion");
  if (!Array.isArray(doc.scenes)) throw new Error("项目文件缺少 scenes");
  if (!Array.isArray(doc.assets)) throw new Error("项目文件缺少 assets");
  return doc;
}

/** 深比较（测试与脏检查用）。 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
