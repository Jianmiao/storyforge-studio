import React, { useMemo, useRef, useState } from "react";
import { Circle, Flag, GitBranch, ListOrdered, Terminal } from "lucide-react";
import { useStore } from "../state/store";
import type { GraphNode, ScriptLine, StudioProject } from "../domain/types";
import {
  AddGraphNodeCommand,
  UpdateGraphNodeCommand,
} from "../domain/commands";
import { buildPathSpans, linearizeDefaultPath } from "../domain/graph";
import { newId } from "../domain/id";
import { Tooltip } from "./ui/Tooltip";

/**
 * 节点式剧本编辑器主视图：节点卡片 + 贝塞尔连线 + 拖拽布局 + 端口连线。
 * 范式参考经典剧情节点图（Entry → Script → Selection → Exit），独立实现。
 */

const NODE_W = 216;
const NODE_H: Record<string, number> = { entry: 76, exit: 76, selection: 96, script: 150 };

function nodeHeight(n: GraphNode): number {
  if (n.type === "script") return Math.max(150, 96 + (n.lines?.length ?? 0) * 26);
  return NODE_H[n.type] ?? 96;
}

function nodeColor(n: GraphNode): string {
  switch (n.type) {
    case "entry":
      return "#2f8f46";
    case "script":
      return "#2b5aa0";
    case "selection":
      return "#b06a1f";
    case "exit":
      return "#b03838";
  }
}

export function NodeGraphView() {
  const document = useStore((s) => s.document);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const playbackPath = useStore((s) => s.playbackPath);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selectNode = useStore((s) => s.selectNode);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const [connectTarget, setConnectTarget] = useState<string | null>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const graph = document?.script;
  const nodes = graph?.nodes ?? [];

  // 连线集合（必须放在所有 hooks 之后、early return 之前 —— Hooks 规则）
  const edges = useMemo(() => {
    const out: { from: string; to: string }[] = [];
    for (const n of nodes) {
      for (const to of n.next) out.push({ from: n.id, to });
    }
    return out;
  }, [nodes]);

  // 当前播放节点（高亮）
  const activeNodeId = useMemo(() => {
    if (!document || !playing) return null;
    const path = playbackPath && playbackPath.length > 0 ? playbackPath : linearizeDefaultPath(document.script);
    const spans = buildPathSpans(document.script, path);
    const span = spans.find((s) => playhead >= s.startFrame && (s.durationFrames === 0 || playhead < s.startFrame + s.durationFrames));
    return span?.nodeId ?? null;
  }, [document, playbackPath, playhead, playing]);

  if (!document) {
    return <div className="node-graph-view empty-hint">新建或打开项目后编辑剧本。</div>;
  }

  const posOf = (id: string) => nodes.find((n) => n.id === id);

  const addNode = (type: GraphNode["type"]) => {
    const st = useStore.getState();
    const doc = st.document!;
    const sel = selectedNodeId ? doc.script.nodes.find((n) => n.id === selectedNodeId) : null;
    const base = sel ?? doc.script.nodes[doc.script.nodes.length - 1];
    const node: GraphNode = {
      id: newId("nd"),
      type,
      x: (base?.x ?? 300) + 240,
      y: base?.y ?? 120,
      title: type === "entry" ? "开场" : type === "exit" ? "结束" : type === "selection" ? "选择" : "新剧本",
      header: type === "entry" ? "" : undefined,
      endText: type === "exit" ? "" : undefined,
      lines: type === "script" ? [makeEmptyLine(doc)] : undefined,
      options: type === "selection" ? ["选项"] : undefined,
      next: [],
    };
    st.executeCommand(new AddGraphNodeCommand(node, doc.script.nodes.length));
    st.selectNode(node.id);
    if (sel && sel.type !== "exit" && type !== "entry" && sel.next.length === 0) {
      // 顺手把选中节点接到新节点
      st.executeCommand(new UpdateGraphNodeCommand(sel.id, sel, { ...sel, next: [...sel.next, node.id] }));
    }
  };

  // 节点拖拽
  const onNodePointerDown = (e: React.PointerEvent, n: GraphNode) => {
    e.stopPropagation();
    selectNode(n.id);
    dragRef.current = { nodeId: n.id, startX: e.clientX, startY: e.clientY, originX: n.x, originY: n.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onNodePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const st = useStore.getState();
    const doc = st.document;
    if (!doc) return;
    const n = doc.script.nodes.find((x) => x.id === drag.nodeId);
    if (!n) return;
    const nx = Math.max(0, drag.originX + (e.clientX - drag.startX));
    const ny = Math.max(0, drag.originY + (e.clientY - drag.startY));
    st.executeCommand(new UpdateGraphNodeCommand(n.id, n, { ...n, x: nx, y: ny }));
  };
  const onNodePointerUp = () => {
    dragRef.current = null;
  };

  // 端口连线
  const onPortPointerDown = (e: React.PointerEvent, n: GraphNode) => {
    e.stopPropagation();
    setConnectingFrom(n.id);
    setConnectCursor({ x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPortPointerMove = (e: React.PointerEvent) => {
    if (!connectingFrom) return;
    setConnectCursor({ x: e.clientX, y: e.clientY });
    const el = window.document.elementFromPoint(e.clientX, e.clientY);
    const target = el?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    setConnectTarget(target && target !== connectingFrom ? target : null);
  };
  const onPortPointerUp = (e: React.PointerEvent) => {
    if (connectingFrom) {
      const el = window.document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
      if (target && target !== connectingFrom) {
        const st = useStore.getState();
        const doc = st.document!;
        const from = doc.script.nodes.find((n) => n.id === connectingFrom)!;
        const to = doc.script.nodes.find((n) => n.id === target)!;
        if (from.type !== "exit" && to.type !== "entry" && !from.next.includes(target)) {
          st.executeCommand(new UpdateGraphNodeCommand(from.id, from, { ...from, next: [...from.next, target] }));
          if (from.type === "selection" && from.options && from.options.length < from.next.length) {
            st.executeCommand(
              new UpdateGraphNodeCommand(from.id, { ...from, next: [...from.next, target] }, {
                ...from,
                next: [...from.next, target],
                options: [...from.options, `选项${from.options.length + 1}`],
              }),
            );
          }
        }
      }
    }
    setConnectingFrom(null);
    setConnectTarget(null);
    setConnectCursor(null);
  };

  const graphEl = window.document.querySelector(".node-graph-view") as HTMLElement | null;
  const viewRect = graphEl?.getBoundingClientRect();

  const bezier = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div
      className="node-graph-view"
      data-testid="node-graph"
      onClick={() => selectNode(null)}
      onPointerMove={onPortPointerMove}
      onPointerUp={onPortPointerUp}
    >
      {/* 连线层 */}
      <svg
        ref={svgRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}
      >
        {edges.map((e, i) => {
          const a = posOf(e.from);
          const b = posOf(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + nodeHeight(a) / 2;
          const x2 = b.x;
          const y2 = b.y + nodeHeight(b) / 2;
          return (
            <path
              key={i}
              d={bezier(x1, y1, x2, y2)}
              fill="none"
              stroke="rgba(120,150,200,0.55)"
              strokeWidth={2}
            />
          );
        })}
        {connectingFrom && connectCursor && viewRect && (() => {
          const a = posOf(connectingFrom);
          if (!a) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + nodeHeight(a) / 2;
          const x2 = connectCursor.x - viewRect.left;
          const y2 = connectCursor.y - viewRect.top;
          return (
            <path d={bezier(x1, y1, x2, y2)} fill="none" stroke={connectTarget ? "#4f8cff" : "rgba(255,255,255,0.5)"} strokeWidth={2} strokeDasharray="6 4" />
          );
        })()}
      </svg>

      {/* 节点层 */}
      {nodes.map((n) => {
        const h = nodeHeight(n);
        const color = nodeColor(n);
        const isSelected = selectedNodeId === n.id;
        const isActive = activeNodeId === n.id;
        const isConnectable = connectTarget === n.id;
        return (
          <div
            key={n.id}
            data-node-id={n.id}
            className={`graph-node ${isSelected ? "selected" : ""} ${isActive ? "active" : ""} ${isConnectable ? "connectable" : ""}`}
            style={{ left: n.x, top: n.y, width: NODE_W, borderTop: `3px solid ${color}` }}
            onPointerDown={(e) => onNodePointerDown(e, n)}
            onPointerMove={onNodePointerMove}
            onPointerUp={onNodePointerUp}
            onClick={(e) => e.stopPropagation()}
            data-testid={`node-${n.id}`}
          >
            <div className="graph-node-head">
              <NodeIcon type={n.type} />
              <span className="graph-node-title">{n.title || "(未命名)"}</span>
            </div>
            {n.type === "entry" && <div className="graph-node-meta">{n.header || "剧本入口"}</div>}
            {n.type === "exit" && <div className="graph-node-meta">{n.endText || "结局"}</div>}
            {n.type === "script" && (
              <div className="graph-node-lines">
                {(n.lines ?? []).slice(0, 4).map((l) => (
                  <div key={l.id} className="graph-node-line">
                    {l.speaker ? `${l.speaker}：` : ""}
                    {l.text || "(空)"}
                  </div>
                ))}
                {(n.lines?.length ?? 0) > 4 && (
                  <div className="graph-node-meta">… 共 {(n.lines ?? []).length} 行</div>
                )}
              </div>
            )}
            {n.type === "selection" && (
              <div className="graph-node-lines">
                {(n.options ?? []).map((o, i) => (
                  <div key={i} className="graph-node-line">
                    ◆ {o}
                  </div>
                ))}
              </div>
            )}
            {/* 输出端口 */}
            {n.type !== "exit" && (
              <div
                className="graph-port"
                style={{ left: NODE_W - 7, top: h / 2 - 7 }}
                onPointerDown={(e) => onPortPointerDown(e, n)}
                title="拖拽到其他节点建立连接"
              />
            )}
          </div>
        );
      })}

      {/* 添加节点工具栏 */}
      <div className="node-toolbar" onClick={(e) => e.stopPropagation()}>
        <Tooltip tip="添加入口节点">
          <button type="button" className="icon-btn" onClick={() => addNode("entry")} aria-label="添加入口节点">
            <Flag size={15} />
          </button>
        </Tooltip>
        <Tooltip tip="添加剧本节点（演出行）">
          <button type="button" className="icon-btn" onClick={() => addNode("script")} aria-label="添加剧本节点">
            <ListOrdered size={15} />
          </button>
        </Tooltip>
        <Tooltip tip="添加选择节点（分支）">
          <button type="button" className="icon-btn" onClick={() => addNode("selection")} aria-label="添加选择节点">
            <GitBranch size={15} />
          </button>
        </Tooltip>
        <Tooltip tip="添加结束节点">
          <button type="button" className="icon-btn" onClick={() => addNode("exit")} aria-label="添加结束节点">
            <Terminal size={15} />
          </button>
        </Tooltip>
      </div>
      <div className="node-hint">
        <Circle size={9} /> 从节点右侧圆点拖到另一节点建立连接 · 拖拽节点移动 · 点击空白取消选中
      </div>
    </div>
  );
}

function NodeIcon({ type }: { type: GraphNode["type"] }) {
  switch (type) {
    case "entry":
      return <Flag size={13} color="#8fe3a0" />;
    case "script":
      return <ListOrdered size={13} color="#9dbdf0" />;
    case "selection":
      return <GitBranch size={13} color="#f0c98f" />;
    case "exit":
      return <Terminal size={13} color="#f09d9d" />;
  }
}

function makeEmptyLine(doc: StudioProject): ScriptLine {
  return {
    id: newId("ln"),
    text: "",
    speaker: "",
    clubName: "",
    characters: [],
    bgAssetId: doc.assets.find((a) => a.kind === "image")?.id ?? null,
    bgEffect: "none",
    bgmAssetId: null,
    voiceAssetId: null,
    soundAssetId: null,
    transition: "none",
    durationFrames: doc.canvas.fps * 4,
    placeText: "",
  };
}
