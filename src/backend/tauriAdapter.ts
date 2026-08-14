import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { BackendAdapter } from "./adapter";
import type { SceneDescriptor } from "../shared/descriptor";
import type { AssetRecord, StudioProject } from "../domain/types";
import type {
  AssetFilter,
  AssetStatus,
  DemoCreateResult,
  FfmpegInfo,
  ImportResult,
  OpenResult,
  RenderJobInfo,
  RenderProgressEvent,
  RenderSpec,
  SaveResult,
} from "./types";

/** 生产后端：Tauri invoke → Rust（studio-core）。 */
export class TauriAdapter implements BackendAdapter {
  readonly kind = "tauri" as const;

  async detectFfmpeg(manualPath?: string | null): Promise<FfmpegInfo> {
    return invoke<FfmpegInfo>("ffmpeg_detect", { manualPath: manualPath ?? null });
  }

  async saveProject(path: string, doc: StudioProject): Promise<SaveResult> {
    return invoke<SaveResult>("project_save", { path, doc });
  }

  async openProject(path: string): Promise<OpenResult> {
    return invoke<OpenResult>("project_open", { path });
  }

  async createDemoProject(dir: string): Promise<DemoCreateResult> {
    return invoke<DemoCreateResult>("demo_create", { dir });
  }

  async importAssets(projectDir: string, sources: string[]): Promise<ImportResult> {
    return invoke<ImportResult>("assets_import", { projectDir, sources });
  }

  async relocateAsset(projectDir: string, assetId: string, newPath: string): Promise<AssetRecord> {
    return invoke<AssetRecord>("assets_relocate", { projectDir, assetId, newPath });
  }

  async checkAssets(projectDir: string): Promise<AssetStatus[]> {
    return invoke<AssetStatus[]>("assets_check", { projectDir });
  }

  async getAssetUrl(projectDir: string, asset: AssetRecord): Promise<string> {
    const path = asset.fileName.includes("/") || asset.fileName.includes("\\")
      ? asset.fileName
      : `${projectDir}\\assets\\${asset.fileName}`;
    return convertFileSrc(path);
  }

  async previewFrame(project: StudioProject, sceneId: string, frame: number): Promise<SceneDescriptor> {
    return invoke<SceneDescriptor>("preview_frame", { project, sceneId, frame });
  }

  async startRender(spec: RenderSpec): Promise<string> {
    return invoke<string>("render_start", { spec });
  }

  async cancelRender(jobId: string): Promise<void> {
    await invoke("render_cancel", { jobId });
  }

  async listRenderJobs(): Promise<RenderJobInfo[]> {
    return invoke<RenderJobInfo[]>("render_list");
  }

  onRenderProgress(cb: (e: RenderProgressEvent) => void): () => void {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<RenderProgressEvent>("render-progress", (event) => {
      if (!cancelled) cb(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }

  async pickFiles(filter: AssetFilter): Promise<string[] | null> {
    const extensions: string[] = [];
    if (filter.images) extensions.push("png", "jpg", "jpeg", "webp", "bmp", "gif");
    if (filter.audio) extensions.push("wav", "mp3", "ogg", "flac", "m4a");
    const result = await open({
      multiple: true,
      filters: [{ name: "支持的素材", extensions }],
    });
    if (!result) return null;
    return Array.isArray(result) ? result : [result];
  }

  async pickSavePath(defaultName: string): Promise<string | null> {
    return save({
      defaultPath: defaultName,
      filters: [{ name: "StoryForge 项目", extensions: ["storyforge"] }],
    });
  }

  async pickOpenPath(): Promise<string | null> {
    const result = await open({
      multiple: false,
      filters: [{ name: "StoryForge 项目", extensions: ["storyforge", "json"] }],
    });
    if (!result) return null;
    return Array.isArray(result) ? result[0] : result;
  }
}
