import React, { useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";
import { useStore } from "../state/store";
import { buildLineSequence, buildPathSpans, linearizeDefaultPath } from "../domain/graph";
import { IconButton } from "./ui/IconButton";

/**
 * 演出序列检查视图（只读）：节点式剧本线性化后的行序列 + 播放头。
 * 编辑在节点图上进行；本视图用于检查流程与跳转。
 */
export function Timeline() {
  const document = useStore((s) => s.document);
  const playhead = useStore((s) => s.playhead);
  const playbackPath = useStore((s) => s.playbackPath);
  const timelineZoom = useStore((s) => s.timelineZoom);
  const playing = useStore((s) => s.playing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const px = timelineZoom;

  // 播放时自动跟随播放头（hooks 必须位于 early return 之前）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const target = playhead * px - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, target);
  }, [playhead, playing, px]);

  if (!document) {
    return (
      <div className="timeline-panel">
        <div className="empty-hint">打开或新建项目后显示演出序列。</div>
      </div>
    );
  }
  const fps = document.canvas.fps;
  const path = playbackPath && playbackPath.length > 0 ? playbackPath : linearizeDefaultPath(document.script);
  const spans = buildLineSequence(document.script, path);
  const pathSpans = buildPathSpans(document.script, path);
  const total = spans.reduce((acc, s) => acc + s.durationFrames, 0);
  const contentWidth = Math.max(800, total * px + 240);

  const typeOfNode = (nodeId: string): string => {
    const n = document.script.nodes.find((x) => x.id === nodeId);
    return n?.type ?? "script";
  };

  const currentSpan = spans.find(
    (s) => playhead >= s.startFrame && playhead < s.startFrame + s.durationFrames,
  );
  const currentLine = currentSpan?.line;

  return (
    <div className="timeline-panel" data-testid="timeline">
      <div className="timeline-header">
        <span style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
          帧 {playhead} / {total} · {timeLabel(playhead, fps)} · 当前行：
        </span>
        <span style={{ fontSize: 11, color: "var(--text-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
          {currentLine ? `${currentLine.speaker ? currentLine.speaker + "：" : ""}${currentLine.text || "(空)"}` : "—"}
        </span>
        <span style={{ flex: 1 }} />
        <IconButton tip="序列缩小" onClick={() => useStore.getState().setTimelineZoom(timelineZoom / 2)}>
          <Minus />
        </IconButton>
        <IconButton tip="序列放大" onClick={() => useStore.getState().setTimelineZoom(timelineZoom * 2)}>
          <Plus />
        </IconButton>
        <span style={{ fontSize: 10, color: "var(--text-2)" }}>{px}px/帧</span>
      </div>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        style={{ flex: 1, overflow: "auto", position: "relative" }}
        data-testid="timeline-scroll"
      >
        <div style={{ width: contentWidth, position: "relative" }}>
          <div className="timeline-ruler" style={{ width: contentWidth }}>
            {rulerTicks(total, px, fps)}
          </div>
          <div className="sequence-lane" style={{ width: contentWidth, height: 64, position: "relative" }}>
            {/* 行块 */}
            {spans.map((s, i) => {
              const type = typeOfNode(s.nodeId);
              return (
                <div
                  key={i}
                  className={`seq-block ${type}`}
                  style={{ left: s.startFrame * px, width: Math.max(8, s.durationFrames * px - 1) }}
                  onClick={() => useStore.getState().setPlayhead(s.startFrame)}
                  data-testid={`seq-${i}`}
                  title={`${type} · ${s.line.text || "(空)"}`}
                >
                  <span className="seq-block-text">
                    {s.line.speaker ? `${s.line.speaker}：` : ""}
                    {s.line.text || "（无文本）"}
                  </span>
                  <span className="seq-block-meta">
                    {s.startFrame}–{s.startFrame + s.durationFrames}
                  </span>
                </div>
              );
            })}
            {/* 选择分支标记 */}
            {pathSpans
              .filter((s) => s.type === "selection")
              .map((s, i) => (
                <div key={i} className="seq-selection" style={{ left: s.startFrame * px }} title="选择分支（播放时弹出选项）">
                  ◆ 选择
                </div>
              ))}
            {/* 播放头 */}
            <div className="playhead-line" style={{ left: playhead * px }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function rulerTicks(totalFrames: number, px: number, fps: number) {
  const step = px >= 12 ? 30 : px >= 6 ? 60 : px >= 3 ? 120 : 240;
  const ticks: React.ReactNode[] = [];
  for (let f = 0; f <= totalFrames; f += step) {
    ticks.push(
      <span
        key={f}
        style={{
          position: "absolute",
          left: f * px,
          top: 3,
          fontSize: 9.5,
          color: "var(--text-2)",
          fontFamily: "var(--font-mono)",
          borderLeft: "1px solid var(--border-strong)",
          paddingLeft: 3,
          height: 14,
        }}
      >
        {timeLabel(f, fps)}
      </span>,
    );
  }
  return ticks;
}

function timeLabel(frame: number, fps: number): string {
  const totalSec = frame / fps;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const f = frame % fps;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
}
