import type { AssetRecord, StudioProject } from "../domain/types";

/** FFmpeg 检测结果。 */
export interface FfmpegInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  /** 用户手动指定的路径（尚未验证时 found=false 但 path 有值）。 */
  manualPath: string | null;
}

export interface SaveResult {
  path: string;
  /** 本次轮换的备份文件名列表（可能为空）。 */
  backups: string[];
}

export interface OpenResult {
  project: StudioProject;
  projectPath: string;
  /** 当主文件损坏、从备份恢复时非空。 */
  recoveredFrom: string | null;
  warnings: string[];
}

export interface AssetStatus {
  assetId: string;
  missing: boolean;
}

export interface RenderSpec {
  /** 渲染快照（独立于编辑中的文档）。 */
  project: StudioProject;
  projectDir: string;
  sceneId: string;
  width: number;
  height: number;
  fps: number;
  codec: "h264";
  crf: number;
  preset: string;
  audioBitrateKbps: number;
  outputPath: string;
}

export type RenderJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface RenderJobInfo {
  id: string;
  status: RenderJobStatus;
  /** 0..total 当前已完成帧。 */
  frame: number;
  total: number;
  etaSec: number | null;
  fps: number | null;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
}

export interface RenderProgressEvent {
  jobId: string;
  status: RenderJobStatus;
  frame: number;
  total: number;
  etaSec: number | null;
  fps: number | null;
  error: string | null;
}

export interface AssetFilter {
  images: boolean;
  audio: boolean;
}

export interface DemoCreateResult {
  projectDir: string;
  project: StudioProject;
}

export interface ImportResult {
  assets: AssetRecord[];
  failed: string[];
}
