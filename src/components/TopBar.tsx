import {
  FolderOpen,
  Play,
  Plus,
  Redo2,
  Save,
  Square,
  Undo2,
  Upload,
  Video,
  Clapperboard,
} from "lucide-react";
import { useStore } from "../state/store";
import { IconButton } from "./ui/IconButton";
import { getBackend } from "../backend";

export function TopBar() {
  const document = useStore((s) => s.document);
  const projectPath = useStore((s) => s.projectPath);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);
  const undoDepth = useStore((s) => s.undoDepth);
  const redoDepth = useStore((s) => s.redoDepth);
  const playing = useStore((s) => s.playing);
  const ffmpeg = useStore((s) => s.ffmpeg);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);

  const onNew = () => {
    const ok = window.confirm("新建项目将丢弃未保存的修改，继续？");
    if (ok) useStore.getState().newProject();
  };
  const onOpen = async () => {
    const backend = await getBackend();
    const path = await backend.pickOpenPath();
    if (path) await useStore.getState().openProject(path);
  };
  const onSave = () => void useStore.getState().saveProject();
  const onDemo = () => void useStore.getState().createDemoProject();

  return (
    <div className="topbar">
      <span style={{ fontWeight: 700, marginRight: 8, color: "var(--text-0)" }}>StoryForge</span>
      <IconButton tip="新建项目 (Ctrl+N)" onClick={onNew}>
        <Plus />
      </IconButton>
      <IconButton tip="打开项目 (Ctrl+O)" onClick={onOpen}>
        <FolderOpen />
      </IconButton>
      <IconButton tip={saving ? "正在保存…" : "保存项目 (Ctrl+S)"} onClick={onSave} disabled={saving || !document}>
        <Save />
      </IconButton>
      <IconButton tip="创建演示项目（离线渲染验收样例）" onClick={onDemo} disabled={!document}>
        <Clapperboard />
      </IconButton>
      <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 6px" }} />
      <IconButton tip="撤销 (Ctrl+Z)" onClick={() => useStore.getState().undo()} disabled={undoDepth === 0}>
        <Undo2 />
      </IconButton>
      <IconButton tip="重做 (Ctrl+Shift+Z)" onClick={() => useStore.getState().redo()} disabled={redoDepth === 0}>
        <Redo2 />
      </IconButton>
      <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 6px" }} />
      <IconButton tip={playing ? "停止 (Space)" : "播放 (Space)"} onClick={() => useStore.getState().setPlaying(!playing)} disabled={!document}>
        {playing ? <Square /> : <Play />}
      </IconButton>
      <IconButton tip="导出视频" onClick={() => setExportDialogOpen(true)} disabled={!document}>
        <Video />
      </IconButton>
      <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 6px" }} />
      <IconButton
        tip="导入素材（图片 / 音频）"
        onClick={() => void useStore.getState().importAssets()}
        disabled={!document}
      >
        <Upload />
      </IconButton>

      <span style={{ flex: 1 }} />
      {ffmpeg && (
        <span
          data-tip={ffmpeg.found ? `FFmpeg: ${ffmpeg.version}` : "FFmpeg 未找到：导出不可用，请在导出对话框指定路径"}
          className="tooltip-wrap"
          style={{
            fontSize: 11,
            color: ffmpeg.found ? "var(--ok)" : "var(--danger)",
            padding: "3px 8px",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        >
          {ffmpeg.found ? "FFmpeg ✓" : "FFmpeg ✗ 缺失"}
        </span>
      )}
      <span style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {projectPath ? projectPath : "未保存"}
        {dirty ? " •" : ""}
      </span>
      {!document && (
        <button
          type="button"
          className="primary"
          onClick={() => useStore.getState().newProject()}
          style={{ marginLeft: 8 }}
        >
          新建项目
        </button>
      )}
    </div>
  );
}
