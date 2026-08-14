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

/**
 * BackendAdapter —— 前端与后端（Tauri Rust / 浏览器 mock）的唯一边界。
 * 生产路径：tauriAdapter（invoke）；开发/UI 测试：mockAdapter。
 * 选择逻辑见 backend/index.ts。
 */
export interface BackendAdapter {
  readonly kind: "tauri" | "mock";

  // --- 系统 ---
  detectFfmpeg(manualPath?: string | null): Promise<FfmpegInfo>;

  // --- 项目 ---
  saveProject(path: string, doc: StudioProject): Promise<SaveResult>;
  openProject(path: string): Promise<OpenResult>;
  /** 新建演示项目：本地合成全部素材，返回完整项目（真实元数据）。 */
  createDemoProject(dir: string): Promise<DemoCreateResult>;

  // --- 素材 ---
  importAssets(projectDir: string, sources: string[]): Promise<ImportResult>;
  relocateAsset(projectDir: string, assetId: string, newPath: string): Promise<AssetRecord>;
  checkAssets(projectDir: string): Promise<AssetStatus[]>;
  /** 素材预览 URL（tauri: convertFileSrc；mock: objectURL）。 */
  getAssetUrl(projectDir: string, asset: AssetRecord): Promise<string>;

  // --- 时间轴求值（预览；path 为剧本演出路径，空 = 默认） ---
  previewFrame(project: StudioProject, path: string[], frame: number): Promise<SceneDescriptor>;

  // --- 渲染 ---
  startRender(spec: RenderSpec): Promise<string>;
  cancelRender(jobId: string): Promise<void>;
  listRenderJobs(): Promise<RenderJobInfo[]>;
  onRenderProgress(cb: (e: RenderProgressEvent) => void): () => void;

  // --- 对话框（tauri: 系统对话框；mock: 浏览器 file input） ---
  pickFiles(filter: AssetFilter): Promise<string[] | null>;
  pickSavePath(defaultName: string): Promise<string | null>;
  pickOpenPath(): Promise<string | null>;
}
