import { useEffect } from "react";
import { getBackend } from "../backend";
import { useStore } from "../state/store";
import { findClipInScene } from "../domain/types";
import { newClipId } from "../domain/id";
import {
  AddClipCommand,
  RemoveAssetCommand,
  RemoveClipCommand,
  RemoveGraphNodeCommand,
} from "../domain/commands";
import type { Clip } from "../domain/types";

/** 剪贴板（模块级）：复制/粘贴片段。 */
let clipboard: { clip: Clip; sceneId: string } | null = null;

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (mod && k === "s") {
        e.preventDefault();
        void useStore.getState().saveProject();
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        useStore.getState().redo();
        return;
      }
      if (mod && k === "n") {
        e.preventDefault();
        if (window.confirm("新建项目将丢弃未保存的修改，继续？")) useStore.getState().newProject();
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        void (async () => {
          const backend = await getBackend();
          const path = await backend.pickOpenPath();
          if (path) await useStore.getState().openProject(path);
        })();
        return;
      }
      if (typing) return;

      const st = useStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        if (st.document) st.setPlaying(!st.playing);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        e.preventDefault();
        if (st.selectedNodeId && st.document) {
          // 节点模式：删除剧本节点（含清理连接）
          const node = st.document.script.nodes.find((n) => n.id === st.selectedNodeId);
          if (node) {
            st.executeCommand(new RemoveGraphNodeCommand(node));
            st.selectNode(null);
          }
        } else if (st.selectedClipId && st.document) {
          const scene = st.document.scenes.find((s) => s.id === st.activeSceneId) ?? st.document.scenes[0];
          const found = scene && findClipInScene(scene, st.selectedClipId);
          if (found) {
            st.executeCommand(new RemoveClipCommand(scene.id, found.track.id, found.clip));
            st.selectClip(null);
          }
        } else if (st.selectedAssetId && st.document) {
          const asset = st.document.assets.find((a) => a.id === st.selectedAssetId);
          if (asset) {
            st.executeCommand(new RemoveAssetCommand(asset));
            st.selectAsset(null);
          }
        }
        return;
      }
      if (mod && k === "c" && st.selectedClipId && st.document) {
        const scene = st.document.scenes.find((s) => s.id === st.activeSceneId) ?? st.document.scenes[0];
        const found = scene && findClipInScene(scene, st.selectedClipId);
        if (found) {
          clipboard = { clip: found.clip, sceneId: scene.id };
        }
        return;
      }
      if (mod && k === "v" && st.document && clipboard) {
        const cb = clipboard;
        const scene = st.document.scenes.find((s) => s.id === st.activeSceneId) ?? st.document.scenes[0];
        const srcScene = st.document.scenes.find((s) => s.id === cb.sceneId) ?? scene;
        const srcTrack = srcScene.tracks.find((t) => t.clips.some((c) => c.id === cb.clip.id));
        if (scene && srcTrack) {
          const targetTrack = scene.tracks.find((t) => t.kind === srcTrack.kind);
          if (targetTrack) {
            const copy: Clip = {
              ...cb.clip,
              id: newClipId(cb.clip.type),
              start: Math.min(scene.durationFrames - 1, st.playhead + 1),
            };
            st.executeCommand(new AddClipCommand(scene.id, targetTrack.id, copy, targetTrack.clips.length));
            st.selectClip(copy.id);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
