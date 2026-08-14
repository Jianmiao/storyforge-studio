import { useEffect } from "react";
import { getBackend } from "../backend";
import { useStore } from "../state/store";
import type { RendererAdapter } from "../preview/RendererAdapter";
import type { SceneDescriptor } from "../shared/descriptor";

/** 最近一次求值描述（模块级，供画布交互命中检测使用）。 */
let lastDesc: SceneDescriptor | null = null;

export function setLastDesc(d: SceneDescriptor | null) {
  lastDesc = d;
}

export function getLastDesc(): SceneDescriptor | null {
  return lastDesc;
}

/**
 * 播放循环：以 performance.now()（单调时钟）为时间源，把时间映射为帧号，
 * 再经后端求值（Rust）渲染。慢于帧间隔时「追赶跳帧」，不重放旧帧。
 * 时间轴求值本身始终按帧号进行，与显示刷新率无关。
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
      if (!doc || !st.activeSceneId) {
        useStore.getState().setPlaying(false);
        return;
      }
      const scene = doc.scenes.find((s) => s.id === st.activeSceneId) ?? doc.scenes[0];
      if (!scene) {
        useStore.getState().setPlaying(false);
        return;
      }
      const fps = Math.max(1, doc.canvas.fps);
      const total = scene.durationFrames;
      let base = Math.min(st.playhead, total - 1);
      let baseTime = performance.now();
      let pending = false;

      const tick = async (now: number) => {
        if (cancelled) return;
        const elapsed = (now - baseTime) / 1000;
        const target = Math.min(total - 1, Math.max(0, Math.floor(base + elapsed * fps)));
        const cur = useStore.getState();
        if (cur.playhead !== target) cur.setPlayhead(target);

        if (!pending && rendererRef.current) {
          pending = true;
          try {
            const backend = await getBackend();
            const d = await backend.previewFrame(cur.document ?? doc, scene.id, target);
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
  if (!st.document || !st.activeSceneId) return;
  try {
    const backend = await getBackend();
    const d = await backend.previewFrame(st.document, st.activeSceneId, st.playhead);
    setLastDesc(d);
    renderer.renderFrame(d);
  } catch {
    // 求值失败忽略（素材缺失等）
  }
}
