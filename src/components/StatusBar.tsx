import { useStore } from "../state/store";
import { backendKind } from "../backend";

export function StatusBar() {
  const document = useStore((s) => s.document);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const playhead = useStore((s) => s.playhead);
  const ffmpeg = useStore((s) => s.ffmpeg);
  const renderJobs = useStore((s) => s.renderJobs);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const dirty = useStore((s) => s.dirty);

  const scene = document
    ? document.scenes.find((s) => s.id === activeSceneId) ?? document.scenes[0]
    : null;
  const running = renderJobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const fps = document?.canvas.fps ?? 30;

  return (
    <div className="statusbar" data-testid="statusbar">
      <span>
        后端：<span style={{ color: "var(--text-1)" }}>{backendKind() === "tauri" ? "桌面 (Rust)" : "浏览器 (mock)"}</span>
      </span>
      <span>
        FFmpeg：<span style={{ color: ffmpeg?.found ? "var(--ok)" : "var(--danger)" }}>{ffmpeg?.found ? "可用" : "未检测到"}</span>
      </span>
      {document && (
        <span>
          帧 {playhead}/{scene?.durationFrames ?? 0} · {(playhead / fps).toFixed(2)}s
        </span>
      )}
      {selectedClipId && <span style={{ color: "var(--accent)" }}>已选片段</span>}
      {running > 0 && <span style={{ color: "var(--warn)" }}>渲染任务 {running} 个进行中</span>}
      {dirty && <span style={{ color: "var(--warn)" }}>有未保存修改</span>}
      <span style={{ flex: 1 }} />
      <span>Ctrl+S 保存 · Ctrl+Z 撤销 · Space 播放/暂停 · Delete 删除 · Ctrl+C/V 复制/粘贴</span>
    </div>
  );
}
