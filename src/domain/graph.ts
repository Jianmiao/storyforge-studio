import type { GraphNode, ScriptGraph, ScriptLine, StudioProject } from "./types";

/**
 * 剧本节点图工具：线性化（默认路径）、演出行序列、帧定位。
 * 与 Rust 侧 crates/studio-core/src/graph.rs 同语义（黄金测试覆盖）。
 */

export interface LineSpan {
  nodeId: string;
  line: ScriptLine;
  /** 全局起始帧。 */
  startFrame: number;
  /** 帧区间 [startFrame, startFrame + durationFrames)。 */
  durationFrames: number;
}

export interface PathSpan {
  nodeId: string;
  type: string;
  /** 该节点在全局序列中的起始帧。 */
  startFrame: number;
  /** 帧区间长度（script = 行总长；selection = 0；entry/exit = 0）。 */
  durationFrames: number;
}

/**
 * 默认演出路径：从 entry 出发，按 next 顺序取首条连接；
 * selection 节点取第一个选项（离线导出默认路径）。
 * 断链即止（不补全其他分支，保证默认路径语义唯一）。
 */
export function linearizeDefaultPath(graph: ScriptGraph): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let cur = graph.entryNodeId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const node = graph.nodes.find((n) => n.id === cur);
    if (!node) break;
    path.push(cur);
    const nextId = node.next[0];
    if (!nextId) break;
    cur = nextId;
  }
  return path;
}

/** 把路径展开为演出行序列（含全局帧区间）。 */
export function buildLineSequence(graph: ScriptGraph, path: string[]): LineSpan[] {
  const spans: LineSpan[] = [];
  let cursor = 0;
  for (const nodeId of path) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    if (node.type === "script" && node.lines) {
      for (const line of node.lines) {
        const dur = Math.max(1, Math.floor(line.durationFrames));
        spans.push({ nodeId, line, startFrame: cursor, durationFrames: dur });
        cursor += dur;
      }
    }
  }
  return spans;
}

/** 路径的节点区间（用于播放器高亮当前节点）。 */
export function buildPathSpans(graph: ScriptGraph, path: string[]): PathSpan[] {
  const spans: PathSpan[] = [];
  let cursor = 0;
  for (const nodeId of path) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    let dur = 0;
    if (node.type === "script" && node.lines) {
      for (const l of node.lines) dur += Math.max(1, Math.floor(l.durationFrames));
    }
    spans.push({ nodeId, type: node.type, startFrame: cursor, durationFrames: dur });
    cursor += dur;
  }
  return spans;
}

/** 总帧数（默认路径）。 */
export function totalFramesOfPath(graph: ScriptGraph, path: string[]): number {
  const spans = buildLineSequence(graph, path);
  return spans.reduce((acc, s) => acc + s.durationFrames, 0);
}

/** 帧定位：返回 frame 所在的行区间；越界返回 null。 */
export function lineSpanAt(spans: LineSpan[], frame: number): LineSpan | null {
  if (frame < 0) return spans[0] ?? null;
  for (const s of spans) {
    if (frame >= s.startFrame && frame < s.startFrame + s.durationFrames) return s;
  }
  return spans.length > 0 ? spans[spans.length - 1] : null;
}

/** 默认路径（未指定时）。 */
export function defaultPathOf(project: StudioProject): string[] {
  return linearizeDefaultPath(project.script);
}

export function nodeOf(graph: ScriptGraph, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}
