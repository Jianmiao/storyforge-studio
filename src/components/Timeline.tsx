import React, { useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";
import { useStore } from "../state/store";
import type { AssetRecord, Clip, Track } from "../domain/types";
import { makeClip, MoveClipCommand, TrimClipCommand, AddClipCommand } from "../domain/commands";
import { Tooltip } from "./ui/Tooltip";
import { IconButton } from "./ui/IconButton";

interface DragState {
  mode: "move" | "trimL" | "trimR";
  clipId: string;
  trackId: string;
  sceneId: string;
  startClientX: number;
  startStart: number;
  startDuration: number;
}

/** 多轨时间轴：缩放、拖动、裁剪片段、关键帧编辑、播放头。 */
export function Timeline() {
  const document = useStore((s) => s.document);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const playhead = useStore((s) => s.playhead);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const timelineZoom = useStore((s) => s.timelineZoom);
  const playing = useStore((s) => s.playing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const scene = document
    ? (document.scenes.find((s) => s.id === activeSceneId) ?? document.scenes[0])
    : null;
  const px = timelineZoom;
  const fps = document?.canvas.fps ?? 30;
  const contentWidth = scene ? scene.durationFrames * px + 240 : 800;
  const selectedAsset = document && selectedAssetId ? document.assets.find((a) => a.id === selectedAssetId) : null;

  // 播放时自动跟随播放头
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const target = playhead * px - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, target);
  }, [playhead, playing, px]);

  if (!document || !scene) {
    return (
      <div className="timeline-panel">
        <div className="empty-hint">打开或新建项目后显示时间轴。</div>
      </div>
    );
  }

  const beginDrag = (e: React.PointerEvent, clip: Clip, track: Track) => {
    e.stopPropagation();
    useStore.getState().selectClip(clip.id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const mode: DragState["mode"] =
      localX < 8 ? "trimL" : localX > rect.width - 8 ? "trimR" : "move";
    dragRef.current = {
      mode,
      clipId: clip.id,
      trackId: track.id,
      sceneId: scene.id,
      startClientX: e.clientX,
      startStart: clip.start,
      startDuration: clip.duration,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startClientX) / px);
    if (delta === 0) return;
    const st = useStore.getState();
    if (!st.document) return;
    const sceneRef = st.document.scenes.find((s) => s.id === drag.sceneId);
    if (!sceneRef) return;
    if (drag.mode === "move") {
      st.executeCommand(new MoveClipCommand(drag.sceneId, drag.clipId, drag.startStart, drag.startStart + delta));
    } else if (drag.mode === "trimL") {
      const newStart = Math.max(0, Math.min(drag.startStart + delta, drag.startStart + drag.startDuration - 1));
      const newDuration = drag.startDuration - (newStart - drag.startStart);
      st.executeCommand(new TrimClipCommand(drag.sceneId, drag.clipId, drag.startStart, drag.startDuration, newStart, newDuration));
    } else {
      const newDuration = Math.max(1, drag.startDuration + delta);
      st.executeCommand(new TrimClipCommand(drag.sceneId, drag.clipId, drag.startStart, drag.startDuration, drag.startStart, newDuration));
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onLaneClick = (e: React.MouseEvent, track: Track) => {
    // 只处理直接点击轨道空白区域（子元素如片段块已各自处理）
    if (e.target !== e.currentTarget) return;
    // 选中轨道
    useStore.getState().selectTrack(track.id);
    useStore.getState().selectClip(null);
    if (!selectedAsset) return;
    // 选中素材 → 在点击处创建片段
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const laneX = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    const start = Math.max(0, Math.floor(laneX / px));
    if (!canPlaceAsset(track.kind, selectedAsset)) {
      useStore.getState().showToast("该素材类型不能放到此轨道（图片 → 背景/角色；音频 → BGM/语音/音效）", "error");
      return;
    }
    const clip = makeClip({
      sceneId: scene.id,
      trackId: track.id,
      type: clipTypeFor(track.kind, selectedAsset),
      assetId: selectedAsset.id,
      start,
      duration: defaultClipDuration(selectedAsset, fps),
    });
    useStore.getState().executeCommand(new AddClipCommand(scene.id, track.id, clip, track.clips.length));
    useStore.getState().selectClip(clip.id);
  };

  return (
    <div className="timeline-panel" data-testid="timeline">
      <div className="timeline-header">
        <span style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
          帧 {playhead} · {timeLabel(playhead, fps)}
        </span>
        <span style={{ flex: 1 }} />
        <Tooltip tip="时间轴缩小">
          <IconButton tip="缩小" onClick={() => useStore.getState().setTimelineZoom(timelineZoom / 2)}>
            <Minus />
          </IconButton>
        </Tooltip>
        <Tooltip tip="时间轴放大">
          <IconButton tip="放大" onClick={() => useStore.getState().setTimelineZoom(timelineZoom * 2)}>
            <Plus />
          </IconButton>
        </Tooltip>
        <span style={{ fontSize: 10, color: "var(--text-2)" }}>{px}px/帧</span>
      </div>
      <div className="timeline-scroll" ref={scrollRef} style={{ flex: 1, overflow: "auto", position: "relative" }} data-testid="timeline-scroll">
        <div style={{ width: contentWidth, position: "relative" }}>
          {/* 标尺 */}
          <div className="timeline-ruler" style={{ width: contentWidth }}>
            {rulerTicks(scene.durationFrames, px, fps)}
          </div>
          {/* 轨道 */}
          <div className="timeline-body" style={{ width: contentWidth }}>
            <div className="timeline-tracks" style={{ width: contentWidth }}>
              {scene.tracks.map((track) => (
                <div className="track-row" key={track.id} style={{ width: contentWidth }}>
                  <div className={`track-label ${selectedTrackId === track.id ? "selected" : ""}`} onClick={() => useStore.getState().selectTrack(track.id)}>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{kindIcon(track.kind)}</span>
                    {track.name}
                    {track.muted && <span style={{ color: "var(--warn)" }}>M</span>}
                  </div>
                  <div
                    className="track-lane"
                    style={{ flex: 1 }}
                    onClick={(e) => onLaneClick(e, track)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    data-testid={`lane-${track.kind}`}
                  >
                    {track.clips.map((clip) => (
                      <div
                        key={clip.id}
                        className={`clip-block ${clip.type} ${selectedClipId === clip.id ? "selected" : ""}`}
                        style={{ left: clip.start * px, width: Math.max(6, clip.duration * px) }}
                        onPointerDown={(e) => beginDrag(e, clip, track)}
                        data-testid={`clip-${clip.id}`}
                        title={`${clip.name} · 起点 ${clip.start} 帧 · 时长 ${clip.duration} 帧`}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{clip.name}</span>
                        {clip.keyframes.length > 0 && (
                          <span className="clip-keyframes">
                            {clip.keyframes.slice(0, 12).map((_k, i) => (
                              <span key={i} className="kf-dot" style={{ marginLeft: 2 }} />
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* 播放头 */}
          <div className="playhead-line" style={{ left: playhead * px }} />
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

function kindIcon(kind: Track["kind"]): string {
  const icons: Record<Track["kind"], string> = {
    background: "▦",
    character: "◉",
    camera: "◎",
    subtitle: "🅣",
    bgm: "♫",
    voice: "♪",
    sfx: "⚡",
    effect: "✦",
  };
  return icons[kind];
}

function canPlaceAsset(trackKind: Track["kind"], asset: AssetRecord): boolean {
  if (asset.kind === "image") return trackKind === "background" || trackKind === "character";
  return trackKind === "bgm" || trackKind === "voice" || trackKind === "sfx";
}

function clipTypeFor(_trackKind: Track["kind"], asset: AssetRecord): Clip["type"] {
  if (asset.kind === "image") return "image";
  return "audio";
}

function defaultClipDuration(asset: AssetRecord, fps: number): number {
  if (asset.kind === "audio") {
    const dur = Math.round(((asset.durationMs ?? 3000) / 1000) * fps);
    return Math.max(15, dur);
  }
  return fps * 5;
}
