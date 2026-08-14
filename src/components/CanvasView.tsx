import React, { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { useStore } from "../state/store";
import { PixiRenderer } from "../preview/pixiRenderer";
import type { RendererAdapter } from "../preview/RendererAdapter";
import { getLastDesc, renderCurrentFrame, setLastDesc, usePlayback } from "../hooks/usePlayback";
import { commitPropValue } from "./PropertiesPanel";
import { findClipInScene } from "../domain/types";
import type { Scene } from "../domain/types";
import { IconButton } from "./ui/IconButton";

/** 画布：PixiJS 渲染 + 编辑覆盖层（选中框 / 拖拽 / 参考线）。 */
export function CanvasView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<RendererAdapter | null>(null);
  const dragRef = useRef<{
    clipId: string;
    scene: Scene;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [showGuides, setShowGuides] = useState(true);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });

  const document = useStore((s) => s.document);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const playhead = useStore((s) => s.playhead);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const playing = useStore((s) => s.playing);

  usePlayback(rendererRef);

  // 初始化渲染器
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    void (async () => {
      const renderer = new PixiRenderer();
      await renderer.init(host, host.clientWidth, host.clientHeight);
      if (disposed) {
        renderer.dispose();
        return;
      }
      rendererRef.current = renderer;
      await renderCurrentFrame(renderer);
    })();
    return () => {
      disposed = true;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // 尺寸观察
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      setHostSize({ w, h });
      rendererRef.current?.resize(w, h);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // 非播放时随播放头/文档渲染
  useEffect(() => {
    if (playing) return;
    void renderCurrentFrame(rendererRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, document, activeSceneId, playing]);

  // 更新选中框（世界 → 屏幕）
  const updateSelectionBox = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !selectedClipId) {
      setSelectionBox(null);
      return;
    }
    const b = renderer.getLayerBounds(selectedClipId);
    if (!b) {
      setSelectionBox(null);
      return;
    }
    const tl = renderer.sceneToScreen({ x: b.x - b.w / 2, y: b.y - b.h / 2 });
    const br = renderer.sceneToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    setSelectionBox({ x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y });
  }, [selectedClipId]);

  useEffect(() => {
    updateSelectionBox();
  }, [selectedClipId, playhead, document, activeSceneId, hostSize, updateSelectionBox]);

  // 指针交互：命中检测 + 拖拽
  const onPointerDown = (e: React.PointerEvent) => {
    const st = useStore.getState();
    if (!st.document || !st.activeSceneId || !rendererRef.current) return;
    if (st.playing) st.setPlaying(false);
    const scene = st.document.scenes.find((s) => s.id === st.activeSceneId) ?? st.document.scenes[0];
    const desc = getLastDesc();
    const renderer = rendererRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pt = renderer.screenToScene({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    // 命中检测（逆序 = 最上层优先）
    let hitId: string | null = null;
    if (desc) {
      for (let i = desc.layers.length - 1; i >= 0; i--) {
        const layer = desc.layers[i];
        const b = renderer.getLayerBounds(layer.id);
        if (!b) continue;
        const pad = 12;
        if (pt.x >= b.x - b.w / 2 - pad && pt.x <= b.x + b.w / 2 + pad && pt.y >= b.y - b.h / 2 - pad && pt.y <= b.y + b.h / 2 + pad) {
          hitId = layer.id;
          break;
        }
      }
    }
    if (!hitId) {
      st.selectClip(null);
      return;
    }
    st.selectClip(hitId);
    dragRef.current = {
      clipId: hitId,
      scene,
      startX: pt.x,
      startY: pt.y,
      originX: 0,
      originY: 0,
      moved: false,
    };
    const found = findClipInScene(scene, hitId);
    if (found && found.clip.type === "image") {
      dragRef.current.originX = found.clip.props.x;
      dragRef.current.originY = found.clip.props.y;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const renderer = rendererRef.current;
    const desc = getLastDesc();
    if (!drag || !renderer || !desc) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pt = renderer.screenToScene({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !drag.moved) return;
    drag.moved = true;
    const W = desc.width;
    const H = desc.height;
    let nx = drag.originX + dx;
    let ny = drag.originY + dy;
    // 吸附中心
    if (Math.abs(nx - W / 2) < 8) nx = W / 2;
    if (Math.abs(ny - H / 2) < 8) ny = H / 2;
    // 本地渲染（无 IPC）
    const local = { ...desc };
    local.layers = local.layers.map((l) => (l.id === drag.clipId ? { ...l, x: nx, y: ny } : l));
    setLastDesc(local);
    renderer.renderFrame(local);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    const st = useStore.getState();
    if (!st.document) return;
    const found = findClipInScene(drag.scene, drag.clipId);
    if (!found || found.clip.type !== "image") return;
    const W = st.document.canvas.width;
    const H = st.document.canvas.height;
    const renderer = rendererRef.current;
    // 从当前渲染帧反查最终值（本地渲染过）
    const layer = getLastDesc()?.layers.find((l) => l.id === drag.clipId);
    const x = layer ? layer.x : Math.min(Math.max(drag.originX, 0), W);
    const y = layer ? layer.y : Math.min(Math.max(drag.originY, 0), H);
    commitPropValue(drag.scene, found.clip, "props.x", Math.round(x), st.playhead);
    commitPropValue(drag.scene, found.clip, "props.y", Math.round(y), st.playhead);
    void renderCurrentFrame(renderer);
  };

  return (
    <div className="center-panel" data-testid="canvas">
      <div
        className="canvas-host"
        ref={hostRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="canvas-overlay">
        {/* 16:9 画布边框（居中） */}
        {hostSize.w > 0 && hostSize.h > 0 && (
          <div
            className="canvas-frame"
            style={{
              width: Math.min(hostSize.w, (hostSize.h * 16) / 9),
              height: Math.min(hostSize.h, (hostSize.w * 9) / 16),
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
          />
        )}
        {showGuides && (
          <>
            <div className="guide-line" style={{ left: "50%", top: 0, bottom: 0, width: 1 }} />
            <div className="guide-line" style={{ top: "50%", left: 0, right: 0, height: 1 }} />
            <div className="guide-line" style={{ left: "50%", top: "50%", width: 14, height: 1, transform: "translate(-50%,-50%)" }} />
            <div className="guide-line" style={{ left: "50%", top: "50%", height: 14, width: 1, transform: "translate(-50%,-50%)" }} />
          </>
        )}
        {selectionBox && (
          <div className="selection-box" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.w, height: selectionBox.h }} />
        )}
      </div>
      <div className="canvas-toolbar">
        <IconButton tip={showGuides ? "隐藏参考线" : "显示参考线"} active={showGuides} onClick={() => setShowGuides(!showGuides)}>
          <Crosshair />
        </IconButton>
      </div>
      <div className="playback-badge">
        {String(playhead).padStart(4, "0")} /{" "}
        {(document && ((document.scenes.find((s) => s.id === activeSceneId) ?? document.scenes[0])?.durationFrames ?? 0))} 帧
        {playing ? " ▶" : ""}
      </div>
    </div>
  );
}
