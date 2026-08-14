import type { BackendAdapter } from "./adapter";
import { evaluateFrame, evaluateGraphFrame } from "../dev/stubEvaluator";
import { linearizeDefaultPath } from "../domain/graph";
import type { SceneDescriptor } from "../shared/descriptor";
import { defaultProject, type AssetRecord, type StudioProject } from "../domain/types";
import { buildDemoProject } from "../domain/demo";
import { migrateProject } from "../domain/migrate";
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
 * 浏览器开发 / UI 测试后端（内存 + localStorage）。
 * - 项目文档持久化到 localStorage（主文件 + bak1..3 模拟轮换备份）。
 * - 素材以 Blob 存内存，objectURL 供预览。
 * - 求值走 DEV 替身 BrowserFallbackEvaluator（仅开发构建；产品路径为 Rust）。
 * - 离线渲染显式拒绝（mock 不伪装导出）。
 */
export class MockAdapter implements BackendAdapter {
  readonly kind = "mock" as const;

  private readonly blobs = new Map<string, Blob>();
  private readonly urls = new Map<string, string>();
  private pendingFiles: File[] = [];
  private jobSeq = 0;
  private readonly jobs = new Map<string, RenderJobInfo>();
  private readonly progressListeners = new Set<(e: RenderProgressEvent) => void>();

  private lsKey(path: string, suffix = ""): string {
    return `sf:${path}${suffix}`;
  }

  // ---------------------------------------------------------------- 系统

  async detectFfmpeg(manualPath?: string | null): Promise<FfmpegInfo> {
    if (manualPath) {
      // mock：手动指定路径即视为可用（UI 流程测试用）
      return { found: true, path: manualPath, version: "ffmpeg version mock (dev)", manualPath };
    }
    return { found: false, path: null, version: null, manualPath: null };
  }

  // ---------------------------------------------------------------- 项目

  async saveProject(path: string, doc: StudioProject): Promise<SaveResult> {
    const json = JSON.stringify(doc, null, 2);
    const backups: string[] = [];
    const prev = localStorage.getItem(this.lsKey(path));
    if (prev) {
      // 轮换备份：main → bak1 → bak2 → bak3
      localStorage.setItem(this.lsKey(path, ".bak3"), localStorage.getItem(this.lsKey(path, ".bak2")) ?? "");
      localStorage.setItem(this.lsKey(path, ".bak2"), localStorage.getItem(this.lsKey(path, ".bak1")) ?? "");
      localStorage.setItem(this.lsKey(path, ".bak1"), prev);
      backups.push(`${path}.bak1`, `${path}.bak2`, `${path}.bak3`);
    }
    localStorage.setItem(this.lsKey(path), json);
    return { path, backups };
  }

  async openProject(path: string): Promise<OpenResult> {
    const raw = localStorage.getItem(this.lsKey(path));
    if (!raw) {
      throw new Error(`找不到项目文件: ${path}`);
    }
    try {
      const doc = migrateProject(JSON.parse(raw));
      return { project: doc, projectPath: path, recoveredFrom: null, warnings: [] };
    } catch {
      // 主文件损坏 → 尝试备份
      for (let i = 1; i <= 3; i++) {
        const bak = localStorage.getItem(this.lsKey(path, `.bak${i}`));
        if (bak) {
          try {
            const doc = migrateProject(JSON.parse(bak));
            return {
              project: doc,
              projectPath: path,
              recoveredFrom: `${path}.bak${i}`,
              warnings: ["主文件损坏，已从备份恢复"],
            };
          } catch {
            // 继续找下一个备份
          }
        }
      }
      throw new Error(`项目文件损坏且无可用备份: ${path}`);
    }
  }

  async createDemoProject(dir: string): Promise<DemoCreateResult> {
    const doc = buildDemoProject(new Date().toISOString());
    // 生成占位素材 blob（与 Rust 端同名的本地合成素材）
    const bg = await makeGradientPngBlob(1920, 1080, "#243447", "#6a5acd", "#ff8c69");
    const char = await makeCharacterPngBlob(480, 720);
    const bgm = makeToneWavBlob(220, 12000, 0.5);
    const sfx = makeToneWavBlob(880, 600, 0.8);
    for (const [assetId, blob] of [
      ["ast_bg", bg],
      ["ast_char", char],
      ["ast_bgm", bgm],
      ["ast_sfx", sfx],
    ] as const) {
      this.blobs.set(assetId, blob);
    }
    for (const a of doc.assets) {
      const blob = this.blobs.get(a.id);
      if (blob) this.urls.set(a.id, URL.createObjectURL(blob));
    }
    const path = `${dir}\\project.storyforge`;
    await this.saveProject(path, doc);
    return { projectDir: dir, project: doc };
  }

  // ---------------------------------------------------------------- 素材

  async importAssets(_projectDir: string, sources: string[]): Promise<ImportResult> {
    const assets: AssetRecord[] = [];
    const failed: string[] = [];
    for (const src of sources) {
      try {
        const idx = Number(src.replace(/^mockfile:\/\//, ""));
        const file = this.pendingFiles[idx];
        if (!file) throw new Error(`无效来源: ${src}`);
        const asset = await this.recordFromFile(file);
        assets.push(asset);
      } catch (e) {
        failed.push(`${src}: ${(e as Error).message}`);
      }
    }
    this.pendingFiles = [];
    return { assets, failed };
  }

  private async recordFromFile(file: File): Promise<AssetRecord> {
    const blob = file;
    const id = `ast_${Math.random().toString(36).slice(2, 10)}`;
    const isImage = file.type.startsWith("image/");
    const record: AssetRecord = {
      id,
      kind: isImage ? "image" : "audio",
      fileName: file.name,
      originalPath: file.name,
      hash: `mock-${file.size}-${file.name}`,
    };
    if (isImage) {
      try {
        const bmp = await createImageBitmap(blob);
        record.width = bmp.width;
        record.height = bmp.height;
        bmp.close();
      } catch {
        // 尺寸未知（测试环境）
      }
    } else {
      const dur = parseWavDurationMs(await blob.arrayBuffer());
      record.durationMs = dur ?? 3000;
    }
    this.blobs.set(id, blob);
    this.urls.set(id, URL.createObjectURL(blob));
    return record;
  }

  async relocateAsset(_projectDir: string, assetId: string, newPath: string): Promise<AssetRecord> {
    const existing = this.blobs.get(assetId);
    if (!existing) throw new Error(`素材不存在: ${assetId}`);
    const url = this.urls.get(assetId);
    if (url) URL.revokeObjectURL(url);
    this.urls.set(assetId, URL.createObjectURL(existing));
    return {
      id: assetId,
      kind: existing.type.startsWith("image/") ? "image" : "audio",
      fileName: newPath.split(/[\\/]/).pop() ?? "relocated",
      originalPath: newPath,
      hash: "mock-relocated",
    };
  }

  async checkAssets(_projectDir: string): Promise<AssetStatus[]> {
    // mock 中 blob 存在即视为存在
    return [...this.blobs.keys()].map((assetId) => ({ assetId, missing: false }));
  }

  async getAssetUrl(_projectDir: string, asset: AssetRecord): Promise<string> {
    const url = this.urls.get(asset.id);
    if (url) return url;
    const blob = this.blobs.get(asset.id);
    if (blob) {
      const u = URL.createObjectURL(blob);
      this.urls.set(asset.id, u);
      return u;
    }
    return "";
  }

  // ---------------------------------------------------------------- 求值（DEV 替身）

  async previewFrame(project: StudioProject, path: string[], frame: number): Promise<SceneDescriptor> {
    // 剧本图优先（v2）；无剧本图回退时间轴（v1 迁移项目）
    if (project.script.entryNodeId && project.script.nodes.length > 0) {
      const effectivePath = path.length > 0 ? path : linearizeDefaultPath(project.script);
      return evaluateGraphFrame(project, effectivePath, frame);
    }
    const sceneId = project.scenes[0]?.id ?? "";
    return evaluateFrame(project, sceneId, frame);
  }

  // ---------------------------------------------------------------- 渲染（显式不支持）

  async startRender(spec: RenderSpec): Promise<string> {
    const id = `job_${++this.jobSeq}`;
    const info: RenderJobInfo = {
      id,
      status: "failed",
      frame: 0,
      total: 1,
      etaSec: null,
      fps: null,
      outputPath: spec.outputPath,
      error: "mock 后端不支持离线渲染；请使用桌面应用（npm run tauri dev）执行真实导出",
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, info);
    this.emitProgress({ jobId: id, status: "failed", frame: 0, total: 1, etaSec: null, fps: null, error: info.error });
    return id;
  }

  async cancelRender(_jobId: string): Promise<void> {
    // no-op
  }

  async listRenderJobs(): Promise<RenderJobInfo[]> {
    return [...this.jobs.values()];
  }

  onRenderProgress(cb: (e: RenderProgressEvent) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  private emitProgress(e: RenderProgressEvent): void {
    for (const cb of this.progressListeners) cb(e);
  }

  // ---------------------------------------------------------------- 对话框（浏览器 file input）

  pickFiles(filter: AssetFilter): Promise<string[] | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      const accept: string[] = [];
      if (filter.images) accept.push("image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif");
      if (filter.audio) accept.push("audio/wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/mp4");
      input.accept = accept.join(",");
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) {
          resolve(null);
          return;
        }
        this.pendingFiles = files;
        resolve(files.map((_, i) => `mockfile://${i}`));
      };
      input.click();
    });
  }

  pickSavePath(defaultName: string): Promise<string | null> {
    return Promise.resolve(`mock://projects/${defaultName || "project.storyforge"}`);
  }

  pickOpenPath(): Promise<string | null> {
    // 打开 mock:// 项目（UI 测试用）：列出 localStorage 中的项目
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sf:") && !k.includes(".bak")) keys.push(k.slice(3));
    }
    if (keys.length === 0) return Promise.resolve(null);
    const choice = window.prompt(`选择要打开的 mock 项目：\n${keys.join("\n")}\n\n输入完整路径（不带 sf: 前缀）`, keys[0]);
    return Promise.resolve(choice ? `mock://${choice}` : null);
  }
}

// ---------------------------------------------------------------- 本地素材合成（mock 用）

async function makeGradientPngBlob(w: number, h: number, c1: string, c2: string, c3: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, c1);
  grad.addColorStop(0.55, c2);
  grad.addColorStop(1, c3);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob 失败"))), "image/png"),
  );
}

async function makeCharacterPngBlob(w: number, h: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  // 简单角色剪影（占位美术，非任何第三方素材）
  ctx.fillStyle = "#8ecae6";
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.3, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#219ebc";
  ctx.beginPath();
  ctx.roundRect(w * 0.28, h * 0.44, w * 0.44, h * 0.5, 24);
  ctx.fill();
  ctx.fillStyle = "#023047";
  ctx.beginPath();
  ctx.roundRect(w * 0.12, h * 0.5, w * 0.18, h * 0.42, 16);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(w * 0.7, h * 0.5, w * 0.18, h * 0.42, 16);
  ctx.fill();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob 失败"))), "image/png"),
  );
}

/** 生成 16bit PCM 正弦音 WAV（本地合成，非第三方素材）。 */
function makeToneWavBlob(freq: number, durationMs: number, volume: number): Blob {
  const sampleRate = 44100;
  const n = Math.floor((sampleRate * durationMs) / 1000);
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // 基音 + 轻微泛音，避免纯正弦太刺耳
    const v = Math.sin(2 * Math.PI * freq * t) * 0.7 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.3;
    data[i] = Math.round(v * volume * 0.9 * 32767);
  }
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);
  new Int16Array(buf, 44, n).set(data);
  return new Blob([buf], { type: "audio/wav" });
}

function parseWavDurationMs(buf: ArrayBuffer): number | null {
  try {
    const view = new DataView(buf);
    const sampleRate = view.getUint32(24, true);
    const dataSize = view.getUint32(40, true);
    if (sampleRate <= 0) return null;
    return Math.round((dataSize / 2 / sampleRate) * 1000);
  } catch {
    return null;
  }
}

export function makeDefaultProjectForMock(): StudioProject {
  return defaultProject("未命名项目");
}
