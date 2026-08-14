import { create } from "zustand";
import { produce } from "immer";
import type { Command, ProjectDraft } from "../domain/commands";
import { History } from "../domain/history";
import { defaultProject, type StudioProject } from "../domain/types";
import { validateProject } from "../domain/schema";
import { getBackend } from "../backend";
import type { FfmpegInfo, RenderJobInfo } from "../backend/types";
import { ProjectPaths } from "../domain/paths";

/**
 * 全局编辑器状态（Zustand）。
 * - document：可序列化项目文档（唯一业务状态；不得藏在组件或 Pixi 对象中）。
 * - 修改 document 的唯一通道：executeCommand（命令模式）。
 * - 自动保存：命令提交后 debounce 1.5s → backend.saveProject。
 */

let history = new History();

interface ToastState {
  kind: "info" | "error" | "success";
  text: string;
}

interface EditorState {
  document: StudioProject | null;
  projectPath: string | null;
  dirty: boolean;
  saving: boolean;
  /** 已保存时的命令版本（用于 dirty 判定）。 */
  savedCommandVersion: number;
  commandVersion: number;
  undoDepth: number;
  redoDepth: number;
  activeSceneId: string | null;
  playhead: number;
  playing: boolean;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  selectedAssetId: string | null;
  timelineZoom: number;
  ffmpeg: FfmpegInfo | null;
  renderJobs: RenderJobInfo[];
  exportDialogOpen: boolean;
  toast: ToastState | null;
  backendReady: boolean;

  // 命令
  executeCommand(cmd: Command): void;
  undo(): void;
  redo(): void;

  // 项目
  newProject(): void;
  saveProject(): Promise<boolean>;
  saveProjectAs(): Promise<boolean>;
  openProject(path: string): Promise<boolean>;
  createDemoProject(): Promise<void>;
  importAssets(): Promise<void>;
  relocateMissingAsset(assetId: string): Promise<void>;

  // UI
  setActiveScene(id: string): void;
  setPlayhead(frame: number): void;
  setPlaying(p: boolean): void;
  selectClip(id: string | null): void;
  selectTrack(id: string | null): void;
  selectAsset(id: string | null): void;
  setTimelineZoom(z: number): void;
  setExportDialogOpen(v: boolean): void;
  showToast(text: string, kind?: ToastState["kind"]): void;
  refreshFfmpeg(): Promise<void>;
  refreshRenderJobs(): Promise<void>;
  refreshAssets(): Promise<void>;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const s = useStore.getState();
    if (s.document && s.projectPath && s.dirty) {
      void s.saveProject();
    }
  }, 1500);
}

function activeSceneOf(doc: StudioProject | null, activeSceneId: string | null) {
  if (!doc) return null;
  return doc.scenes.find((s) => s.id === activeSceneId) ?? doc.scenes[0] ?? null;
}

export const useStore = create<EditorState>((set, get) => ({
  document: null,
  projectPath: null,
  dirty: false,
  saving: false,
  savedCommandVersion: 0,
  commandVersion: 0,
  undoDepth: 0,
  redoDepth: 0,
  activeSceneId: null,
  playhead: 0,
  playing: false,
  selectedClipId: null,
  selectedTrackId: null,
  selectedAssetId: null,
  timelineZoom: 4,
  ffmpeg: null,
  renderJobs: [],
  exportDialogOpen: false,
  toast: null,
  backendReady: false,

  executeCommand(cmd) {
    const state = get();
    if (!state.document) return;
    const scene = activeSceneOf(state.document, state.activeSceneId);
    const nextDoc = produce(state.document, (draft) => {
      cmd.apply(draft as ProjectDraft);
    });
    history.execute(cmd);
    const commandVersion = state.commandVersion + 1;
    set({
      document: nextDoc,
      dirty: true,
      commandVersion,
      undoDepth: history.undoDepth(),
      redoDepth: history.redoDepth(),
      playhead: scene ? Math.min(state.playhead, scene.durationFrames - 1) : state.playhead,
    });
    scheduleAutosave();
  },

  undo() {
    const state = get();
    if (!state.document || !history.canUndo()) return;
    const nextDoc = produce(state.document, (draft) => {
      history.undo(draft as ProjectDraft);
    });
    set({
      document: nextDoc,
      dirty: true,
      undoDepth: history.undoDepth(),
      redoDepth: history.redoDepth(),
    });
    scheduleAutosave();
  },

  redo() {
    const state = get();
    if (!state.document || !history.canRedo()) return;
    const nextDoc = produce(state.document, (draft) => {
      history.redo(draft as ProjectDraft);
    });
    set({
      document: nextDoc,
      dirty: true,
      undoDepth: history.undoDepth(),
      redoDepth: history.redoDepth(),
    });
    scheduleAutosave();
  },

  newProject() {
    history = new History();
    const doc = defaultProject("未命名项目");
    set({
      document: doc,
      projectPath: null,
      dirty: false,
      savedCommandVersion: 0,
      commandVersion: 0,
      undoDepth: 0,
      redoDepth: 0,
      activeSceneId: doc.scenes[0]?.id ?? null,
      playhead: 0,
      playing: false,
      selectedClipId: null,
      selectedTrackId: null,
      selectedAssetId: null,
      toast: { kind: "info", text: "已新建项目" },
    });
  },

  async saveProject() {
    const state = get();
    if (!state.document) return false;
    if (!state.projectPath) {
      return get().saveProjectAs();
    }
    if (state.saving) return false;
    set({ saving: true });
    try {
      const backend = await getBackend();
      const doc: StudioProject = {
        ...state.document,
        meta: { ...state.document.meta, updatedAt: new Date().toISOString() },
      };
      await backend.saveProject(state.projectPath, doc);
      set({ saving: false, dirty: false, savedCommandVersion: get().commandVersion });
      return true;
    } catch (e) {
      set({ saving: false });
      get().showToast(`保存失败: ${(e as Error).message}`, "error");
      return false;
    }
  },

  async saveProjectAs() {
    const state = get();
    if (!state.document) return false;
    const backend = await getBackend();
    const name = state.document.meta.name || "project.storyforge";
    const path = await backend.pickSavePath(name.endsWith(".storyforge") ? name : `${name}.storyforge`);
    if (!path) return false;
    set({ projectPath: path });
    return get().saveProject();
  },

  async openProject(path) {
    try {
      const backend = await getBackend();
      const result = await backend.openProject(path);
      history = new History();
      const errors = validateProject(result.project);
      set({
        document: result.project,
        projectPath: result.projectPath,
        dirty: false,
        savedCommandVersion: 0,
        commandVersion: 0,
        undoDepth: 0,
        redoDepth: 0,
        activeSceneId: result.project.scenes[0]?.id ?? null,
        playhead: 0,
        playing: false,
        selectedClipId: null,
        selectedTrackId: null,
        selectedAssetId: null,
        toast: {
          kind: result.recoveredFrom ? "error" : "success",
          text: result.recoveredFrom
            ? `已从备份恢复项目（${result.recoveredFrom}）`
            : `已打开 ${result.projectPath}`,
        },
      });
      if (errors.length > 0) {
        get().showToast(`项目校验警告（${errors.length} 项）：${errors.slice(0, 3).join("；")}`, "error");
      }
      await get().refreshAssets();
      return true;
    } catch (e) {
      get().showToast(`打开失败: ${(e as Error).message}`, "error");
      return false;
    }
  },

  async createDemoProject() {
    try {
      const backend = await getBackend();
      const result = await backend.createDemoProject("demo");
      history = new History();
      const projectPath = new ProjectPaths(result.projectDir).projectFile();
      set({
        document: result.project,
        projectPath,
        dirty: true,
        undoDepth: 0,
        redoDepth: 0,
        activeSceneId: result.project.scenes[0]?.id ?? null,
        playhead: 0,
        playing: false,
        selectedClipId: null,
        toast: { kind: "success", text: "演示项目已创建" },
      });
    } catch (e) {
      get().showToast(`创建演示项目失败: ${(e as Error).message}`, "error");
    }
  },

  async importAssets() {
    const state = get();
    if (!state.document) return;
    if (!state.projectPath) {
      const ok = await get().saveProjectAs();
      if (!ok) return;
    }
    const backend = await getBackend();
    const paths = await backend.pickFiles({ images: true, audio: true });
    if (!paths || paths.length === 0) return;
    const projectDir = new ProjectPaths(get().projectPath!).root();
    const result = await backend.importAssets(projectDir, paths);
    if (result.assets.length > 0) {
      const { AddAssetCommand } = await import("../domain/commands");
      for (const asset of result.assets) {
        get().executeCommand(new AddAssetCommand(asset));
      }
      get().showToast(`已导入 ${result.assets.length} 个素材`, "success");
    }
    if (result.failed.length > 0) {
      get().showToast(`导入失败 ${result.failed.length} 个：${result.failed[0]}`, "error");
    }
  },

  async relocateMissingAsset(assetId) {
    const state = get();
    if (!state.document || !state.projectPath) return;
    const backend = await getBackend();
    const path = await backend.pickOpenPath();
    if (!path) return;
    try {
      const projectDir = new ProjectPaths(state.projectPath).root();
      const updated = await backend.relocateAsset(projectDir, assetId, path);
      const { RelocateAssetCommand } = await import("../domain/commands");
      const asset = state.document.assets.find((a) => a.id === assetId);
      if (!asset) return;
      get().executeCommand(
        new RelocateAssetCommand(
          assetId,
          asset.fileName,
          asset.originalPath,
          updated.fileName,
          updated.originalPath,
        ),
      );
      get().showToast("素材已重新定位", "success");
    } catch (e) {
      get().showToast(`重新定位失败: ${(e as Error).message}`, "error");
    }
  },

  setActiveScene(id) {
    set({ activeSceneId: id, playhead: 0, selectedClipId: null });
  },

  setPlayhead(frame) {
    const state = get();
    const scene = activeSceneOf(state.document, state.activeSceneId);
    const max = scene ? scene.durationFrames - 1 : 0;
    set({ playhead: Math.max(0, Math.min(frame, max)) });
  },

  setPlaying(p) {
    set({ playing: p });
  },

  selectClip(id) {
    set({ selectedClipId: id, selectedTrackId: null });
  },

  selectTrack(id) {
    set({ selectedTrackId: id, selectedClipId: null });
  },

  selectAsset(id) {
    set({ selectedAssetId: id });
  },

  setTimelineZoom(z) {
    set({ timelineZoom: Math.max(0.5, Math.min(z, 64)) });
  },

  setExportDialogOpen(v) {
    set({ exportDialogOpen: v });
  },

  showToast(text, kind = "info") {
    set({ toast: { kind, text } });
    // 自动清除
    setTimeout(() => {
      const cur = get().toast;
      if (cur && cur.text === text) set({ toast: null });
    }, 4000);
  },

  async refreshFfmpeg() {
    try {
      const backend = await getBackend();
      const info = await backend.detectFfmpeg();
      set({ ffmpeg: info, backendReady: true });
    } catch {
      set({ backendReady: true });
    }
  },

  async refreshRenderJobs() {
    try {
      const backend = await getBackend();
      const jobs = await backend.listRenderJobs();
      set({ renderJobs: jobs });
    } catch {
      // 忽略（mock 或未初始化）
    }
  },

  async refreshAssets() {
    const state = get();
    if (!state.document || !state.projectPath) return;
    try {
      const backend = await getBackend();
      const projectDir = new ProjectPaths(state.projectPath).root();
      const statuses = await backend.checkAssets(projectDir);
      const missingIds = new Set(statuses.filter((s) => s.missing).map((s) => s.assetId));
      if (missingIds.size === 0) return;
      const doc = produce(state.document, (draft) => {
        for (const a of draft.assets) {
          a.missing = missingIds.has(a.id);
        }
      });
      set({ document: doc });
      get().showToast(`检测到 ${missingIds.size} 个缺失素材（可在资源库中重新定位）`, "error");
    } catch {
      // 忽略
    }
  },
}));

/** 便于非 React 模块读取 store。 */
export function getHistory(): History {
  return history;
}
