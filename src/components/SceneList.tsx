import { Plus, Trash2 } from "lucide-react";
import { useStore } from "../state/store";
import { newSceneId, newTrackId } from "../domain/id";
import type { Scene } from "../domain/types";
import { AddSceneCommand, RemoveSceneCommand } from "../domain/commands";
import { Tooltip } from "./ui/Tooltip";

export function SceneList() {
  const document = useStore((s) => s.document);
  const activeSceneId = useStore((s) => s.activeSceneId);

  if (!document) return null;

  const addScene = () => {
    const scene: Scene = {
      id: newSceneId(),
      name: `场景 ${document.scenes.length + 1}`,
      durationFrames: document.canvas.fps * 30,
      tracks: [
        { id: newTrackId("background"), kind: "background", name: "背景", muted: false, clips: [] },
        { id: newTrackId("character"), kind: "character", name: "角色", muted: false, clips: [] },
        { id: newTrackId("camera"), kind: "camera", name: "镜头", muted: false, clips: [] },
        { id: newTrackId("subtitle"), kind: "subtitle", name: "字幕", muted: false, clips: [] },
        { id: newTrackId("bgm"), kind: "bgm", name: "BGM", muted: false, clips: [] },
        { id: newTrackId("voice"), kind: "voice", name: "语音", muted: false, clips: [] },
        { id: newTrackId("sfx"), kind: "sfx", name: "音效", muted: false, clips: [] },
        { id: newTrackId("effect"), kind: "effect", name: "特效", muted: false, clips: [] },
      ],
    };
    useStore.getState().executeCommand(new AddSceneCommand(scene, document.scenes.length));
    useStore.getState().setActiveScene(scene.id);
  };

  const removeScene = (scene: Scene) => {
    if (document.scenes.length <= 1) {
      useStore.getState().showToast("至少保留一个场景", "error");
      return;
    }
    const ok = window.confirm(`删除场景「${scene.name}」？`);
    if (!ok) return;
    useStore.getState().executeCommand(new RemoveSceneCommand(scene));
    useStore.getState().setActiveScene(useStore.getState().document!.scenes[0].id);
  };

  return (
    <>
      <div className="panel-title">
        <span>场景</span>
        <Tooltip tip="添加场景">
          <button type="button" className="icon-btn" onClick={addScene} aria-label="添加场景">
            <Plus />
          </button>
        </Tooltip>
      </div>
      <div className="scene-list" data-testid="scene-list">
        {document.scenes.map((s) => (
          <div
            key={s.id}
            className={`scene-item ${activeSceneId === s.id ? "active" : ""}`}
            onClick={() => useStore.getState().setActiveScene(s.id)}
            data-testid={`scene-${s.id}`}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            <span style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
              {(s.durationFrames / (document.canvas.fps || 30)).toFixed(1)}s
            </span>
            <Tooltip tip="删除场景">
              <button
                type="button"
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeScene(s);
                }}
                aria-label={`删除场景 ${s.name}`}
              >
                <Trash2 size={12} />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
    </>
  );
}
