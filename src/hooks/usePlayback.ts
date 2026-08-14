import { useEffect } from "react";
import { getBackend } from "../backend";
import { useStore } from "../state/store";
import type { RendererAdapter } from "../preview/RendererAdapter";
import type { SceneDescriptor } from "../shared/descriptor";
import { buildLineSequence, buildPathSpans, linearizeDefaultPath, nodeOf } from "../domain/graph";

/** 最近一次求值描述（模块级，供画布交互命中检测使用）。 */
let lastDesc: SceneDescriptor | null = null;

export function setLastDesc(d: SceneDescriptor | null) {
  lastDesc = d;
}

export function getLastDesc(): SceneDescriptor | null {
  return lastDesc;
}

/**
 * 播放循环：以 performance.now()（单调时钟）为时间源，按剧本路径逐帧求值（Rust）。
 * 遇到选择节点（某 script 节点播完且 next 指向 selection）时暂停并弹出选项，
 * 用户选择后重建路径继续。慢于帧间隔时「追赶跳帧」。
 */
export function usePlayback(rendererRef: React.RefObject<RendererAdapter | null>) {
  const playing = useStore((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    let raf = 0;

    void (async () => {
      const st = useStore.getState();
      const doc = st.document;
      if (!doc) {
        useStore.getState().setPlaying(false);
        return;
      }
      // 无剧本图（v1 迁移项目）：不进入节点播放
      if (!doc.script.entryNodeId || doc.script.nodes.length === 0) {
        useStore.getState().setPlaying(false);
        useStore.getState().showToast("该项目为时间轴格式（v1），暂不支持节点播放", "error");
        return;
      }
      const path =
        st.playbackPath && st.playbackPath.length > 0
          ? [...st.playbackPath]
          : linearizeDefaultPath(doc.script);
      const spans = buildLineSequence(doc.script, path);
      const total = spans.reduce((acc, s) => acc + s.durationFrames, 0);
      if (total <= 0) {
        useStore.getState().setPlaying(false);
        return;
      }
      const pathSpans = buildPathSpans(doc.script, path);
      const fps = Math.max(1, doc.canvas.fps);
      let base = Math.min(st.playhead, total - 1);
      let baseTime = performance.now();
      let pending = false;

      const tick = async (now: number) => {
        if (cancelled) return;
        const elapsed = (now - baseTime) / 1000;
        const target = Math.min(total - 1, Math.max(0, Math.floor(base + elapsed * fps)));
        const cur = useStore.getState();

        // 分支检测：当前 script 节点播完，且 next 指向 selection 节点 → 暂停等待选择
        const curSpan = pathSpans.find(
          (s) => s.durationFrames > 0 && target >= s.startFrame && target < s.startFrame + s.durationFrames,
        );
        const curNode = curSpan ? nodeOf(doc.script, curSpan.nodeId) : null;
        const nextId = curNode?.next[0];
        const nextNode = nextId ? nodeOf(doc.script, nextId) : null;
        const atNodeEnd = curSpan !== undefined && target >= curSpan.startFrame + curSpan.durationFrames - 1;
        if (atNodeEnd && nextNode?.type === "selection" && nextId) {
          cur.setPendingChoice({
            selectionNodeId: nextId,
            prompt: nextNode.title,
            options: nextNode.options ?? [],
          });
          cur.setPlaying(false);
          return;
        }

        if (cur.playhead !== target) cur.setPlayhead(target);

        if (!pending && rendererRef.current) {
          pending = true;
          try {
            const backend = await getBackend();
            const d = await backend.previewFrame(cur.document ?? doc, path, target);
            setLastDesc(d);
            rendererRef.current?.renderFrame(d);
            // 追赶校准：落后超过 2 帧时重设基准
            const now2 = performance.now();
            const realTarget = Math.floor(base + ((now2 - baseTime) / 1000) * fps);
            if (realTarget - target > 2) {
              base = realTarget;
              baseTime = now2;
            }
          } catch {
            // 求值失败：跳过该帧
          } finally {
            pending = false;
          }
        }
        if (target >= total - 1 || !useStore.getState().playing) {
          if (target >= total - 1) useStore.getState().setPlaying(false);
          return;
        }
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [playing, rendererRef]);
}

/** 渲染当前播放头帧（非播放时使用）。 */
export async function renderCurrentFrame(renderer: RendererAdapter | null): Promise<void> {
  if (!renderer) return;
  const st = useStore.getState();
  if (!st.document || !st.document.script.entryNodeId) return;
  try {
    const backend = await getBackend();
    const path =
      st.playbackPath && st.playbackPath.length > 0 ? st.playbackPath : linearizeDefaultPath(st.document.script);
    const d = await backend.previewFrame(st.document, path, st.playhead);
    setLastDesc(d);
    renderer.renderFrame(d);
  } catch {
    // 求值失败忽略（素材缺失等）
  }
}
