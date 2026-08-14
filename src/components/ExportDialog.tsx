import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { Modal } from "./ui/Modal";
import { useStore } from "../state/store";
import { getBackend } from "../backend";
import { backendKind } from "../backend";
import type { RenderSpec } from "../backend/types";
import { ProjectPaths } from "../domain/paths";

/** 导出对话框：配置 + 渲染队列（进度 / ETA / 取消 / 失败原因）。 */
export function ExportDialog() {
  const open = useStore((s) => s.exportDialogOpen);
  const setOpen = useStore((s) => s.setExportDialogOpen);
  const document = useStore((s) => s.document);
  const projectPath = useStore((s) => s.projectPath);
  const ffmpeg = useStore((s) => s.ffmpeg);
  const renderJobs = useStore((s) => s.renderJobs);
  const showToast = useStore((s) => s.showToast);

  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [crf, setCrf] = useState(18);
  const [preset, setPreset] = useState("veryfast");
  const [audioBitrateKbps, setAudioBitrateKbps] = useState(192);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [manualFfmpeg, setManualFfmpeg] = useState("");
  const [presetRes, setPresetRes] = useState("1080p");

  useEffect(() => {
    if (!open || !document) return;
    setWidth(document.export.width);
    setHeight(document.export.height);
    setFps(document.export.fps);
    setCrf(document.export.crf);
    setPreset(document.export.preset);
    setAudioBitrateKbps(document.export.audioBitrateKbps);
  }, [open, document]);

  if (!open || !document) return null;

  const applyResolution = (v: string) => {
    setPresetRes(v);
    if (v === "1080p") { setWidth(1920); setHeight(1080); }
    else if (v === "720p") { setWidth(1280); setHeight(720); }
    else if (v === "480p") { setWidth(854); setHeight(480); }
  };

  const pickOutput = async () => {
    const backend = await getBackend();
    const p = await backend.pickSavePath("storyforge-output.mp4");
    if (p) setOutputPath(p);
  };

  const verifyFfmpeg = async () => {
    const backend = await getBackend();
    const info = await backend.detectFfmpeg(manualFfmpeg.trim() || null);
    useStore.setState({ ffmpeg: info });
    showToast(
      info.found ? `FFmpeg 可用：${info.version}` : "FFmpeg 未找到（请检查路径）",
      info.found ? "success" : "error",
    );
  };

  const enqueue = async () => {
    if (!document || !projectPath) {
      showToast("请先保存项目（Ctrl+S）再导出", "error");
      return;
    }
    if (!ffmpeg?.found) {
      showToast("FFmpeg 未找到，无法导出（请在上方指定路径）", "error");
      return;
    }
    if (!outputPath) {
      showToast("请选择输出路径", "error");
      return;
    }
    const backend = await getBackend();
    const projectDir = new ProjectPaths(projectPath).root();
    const st = useStore.getState();
    const spec: RenderSpec = {
      project: document,
      projectDir,
      // 导出当前播放路径；未选择过分支时为空（后端按默认路径）
      path: st.playbackPath && st.playbackPath.length > 0 ? [...st.playbackPath] : [],
      width,
      height,
      fps,
      codec: "h264",
      crf,
      preset,
      audioBitrateKbps,
      outputPath,
    };
    try {
      const jobId = await backend.startRender(spec);
      showToast(`已加入渲染队列（${jobId}）`, "success");
      void useStore.getState().refreshRenderJobs();
    } catch (e) {
      showToast(`加入队列失败: ${(e as Error).message}`, "error");
    }
  };

  const cancelJob = async (jobId: string) => {
    const backend = await getBackend();
    await backend.cancelRender(jobId);
    void useStore.getState().refreshRenderJobs();
  };

  const runningJobs = renderJobs.filter((j) => j.status === "running" || j.status === "queued").length;

  return (
    <Modal
      title="导出视频（离线渲染）"
      onClose={() => setOpen(false)}
      footer={
        <>
          <button type="button" onClick={() => setOpen(false)}>
            关闭
          </button>
          <button type="button" className="primary" onClick={() => void enqueue()} data-testid="enqueue-render">
            <Play size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            加入渲染队列
          </button>
        </>
      }
    >
      {/* FFmpeg 状态 */}
      <div
        style={{
          padding: 8,
          borderRadius: 6,
          border: `1px solid ${ffmpeg?.found ? "var(--ok)" : "var(--danger)"}`,
          background: ffmpeg?.found ? "rgba(63,185,80,0.08)" : "rgba(229,83,75,0.08)",
          fontSize: 12,
        }}
        data-testid="ffmpeg-status"
      >
        {ffmpeg?.found ? (
          <>
            <span style={{ color: "var(--ok)" }}>FFmpeg 可用</span>
            <span style={{ color: "var(--text-2)", marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}>{ffmpeg.version}</span>
          </>
        ) : (
          <>
            <span style={{ color: "var(--danger)" }}>FFmpeg 未找到</span>
            <span style={{ color: "var(--text-2)", marginLeft: 8 }}>请安装 FFmpeg 并加入 PATH，或手动指定路径：</span>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                type="text"
                style={{ flex: 1 }}
                placeholder="例如 E:\ffmpeg\bin\ffmpeg.exe"
                value={manualFfmpeg}
                onChange={(e) => setManualFfmpeg(e.target.value)}
                data-testid="ffmpeg-manual-path"
              />
              <button type="button" onClick={() => void verifyFfmpeg()}>
                检测
              </button>
            </div>
          </>
        )}
        {backendKind() === "mock" && (
          <div style={{ marginTop: 6, color: "var(--warn)" }}>
            当前为浏览器开发模式（mock 后端），真实导出请运行桌面应用：npm run tauri dev
          </div>
        )}
      </div>

      {/* 配置 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="prop-row">
          <label>分辨率</label>
          <select value={presetRes} onChange={(e) => applyResolution(e.target.value)}>
            <option value="1080p">1080p (1920×1080)</option>
            <option value="720p">720p (1280×720)</option>
            <option value="480p">480p (854×480)</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        {presetRes === "custom" && (
          <>
            <div className="prop-row">
              <label>宽度</label>
              <input type="number" min={64} value={width} onChange={(e) => setWidth(Math.max(64, Number(e.target.value) || 64))} />
            </div>
            <div className="prop-row">
              <label>高度</label>
              <input type="number" min={64} value={height} onChange={(e) => setHeight(Math.max(64, Number(e.target.value) || 64))} />
            </div>
          </>
        )}
        <div className="prop-row">
          <label>帧率</label>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            <option value={24}>24</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </div>
        <div className="prop-row">
          <label>编码质量</label>
          <select value={crf} onChange={(e) => setCrf(Number(e.target.value))}>
            <option value={14}>高 (CRF 14)</option>
            <option value={18}>标准 (CRF 18)</option>
            <option value={23}>小文件 (CRF 23)</option>
            <option value={28}>低 (CRF 28)</option>
          </select>
        </div>
        <div className="prop-row">
          <label>编码速度</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="ultrafast">ultrafast</option>
            <option value="veryfast">veryfast</option>
            <option value="medium">medium</option>
            <option value="slow">slow</option>
          </select>
        </div>
        <div className="prop-row">
          <label>音频码率</label>
          <select value={audioBitrateKbps} onChange={(e) => setAudioBitrateKbps(Number(e.target.value))}>
            <option value={128}>128 kbps</option>
            <option value={192}>192 kbps</option>
            <option value={256}>256 kbps</option>
          </select>
        </div>
      </div>

      <div className="prop-row">
        <label>输出路径</label>
        <input type="text" style={{ flex: 1 }} value={outputPath ?? ""} placeholder="选择输出 MP4 路径…" readOnly data-testid="output-path" />
        <button type="button" onClick={() => void pickOutput()}>
          浏览…
        </button>
      </div>

      {/* 渲染队列 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="panel-title" style={{ padding: "4px 0" }}>
          <span>渲染队列（{runningJobs} 进行中）</span>
        </div>
        {renderJobs.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>暂无任务。配置完成后点击「加入渲染队列」。</div>
        )}
        {renderJobs.map((job) => (
          <div className="render-job" key={job.id} data-testid={`render-job-${job.id}`}>
            <div className="job-head">
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>{job.id}</span>
              <span
                className={
                  job.status === "done" ? "job-status-done"
                  : job.status === "failed" ? "job-status-failed"
                  : job.status === "cancelled" ? "job-status-cancelled"
                  : ""
                }
              >
                {job.status === "queued" && "排队中…"}
                {job.status === "running" && `渲染中 ${job.frame}/${job.total} 帧`}
                {job.status === "done" && `完成 · ${job.total} 帧`}
                {job.status === "failed" && "失败"}
                {job.status === "cancelled" && "已取消"}
              </span>
              {(job.status === "running" || job.status === "queued") && (
                <button type="button" className="danger" style={{ padding: "2px 8px" }} onClick={() => void cancelJob(job.id)}>
                  <Square size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                  取消
                </button>
              )}
            </div>
            {job.status === "running" && (
              <>
                <div className="job-progress-track">
                  <div
                    className="job-progress-fill"
                    style={{ width: `${job.total > 0 ? Math.round((job.frame / job.total) * 100) : 0}%` }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
                  {job.frame}/{job.total} 帧 · {job.fps ? `${job.fps.toFixed(1)} fps` : "—"} · ETA {job.etaSec != null ? `${job.etaSec.toFixed(0)}s` : "—"}
                </div>
              </>
            )}
            {job.status === "done" && job.outputPath && (
              <div style={{ fontSize: 11, color: "var(--text-2)", wordBreak: "break-all" }}>{job.outputPath}</div>
            )}
            {job.status === "failed" && job.error && (
              <div style={{ fontSize: 11, color: "var(--danger)", wordBreak: "break-all" }}>{job.error}</div>
            )}
            {job.status === "cancelled" && (
              <div style={{ fontSize: 11, color: "var(--warn)" }}>已取消并清理临时文件</div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
