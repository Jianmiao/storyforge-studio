import { useEffect, useState } from "react";
import { AudioLines, FileWarning, Image as ImageIcon, Upload } from "lucide-react";
import { useStore } from "../state/store";
import { getBackend } from "../backend";
import { Tooltip } from "./ui/Tooltip";

export function AssetLibrary() {
  const document = useStore((s) => s.document);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const projectPath = useStore((s) => s.projectPath);
  const selectAsset = useStore((s) => s.selectAsset);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const projectDir = projectPath ? projectPath.replace(/[\\/][^\\/]+$/, "") : "";

  // 素材预览 URL（tauri: convertFileSrc；mock: objectURL）
  useEffect(() => {
    if (!document || !projectDir) return;
    let cancelled = false;
    void (async () => {
      const backend = await getBackend();
      const next: Record<string, string> = {};
      for (const a of document.assets) {
        try {
          next[a.id] = await backend.getAssetUrl(projectDir, a);
        } catch {
          // 预览 URL 失败不阻断
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [document, projectDir]);

  if (!document) {
    return (
      <>
        <div className="panel-title">
          <span>素材库</span>
        </div>
        <div className="empty-hint">新建或打开项目后导入素材。</div>
      </>
    );
  }

  return (
    <>
      <div className="panel-title" data-testid="asset-library">
        <span>素材库</span>
        <Tooltip tip="导入图片 / 音频（PNG/JPG/WebP/WAV/MP3/OGG）">
          <button type="button" className="icon-btn" onClick={() => void useStore.getState().importAssets()} aria-label="导入素材">
            <Upload />
          </button>
        </Tooltip>
      </div>
      {document.assets.length === 0 ? (
        <div className="empty-hint">
          尚无素材。
          <br />
          点击右上角导入按钮，从本地选择图片或音频文件。
          <br />
          <br />
          也可在顶栏创建演示项目。
        </div>
      ) : (
        <div className="asset-grid">
          {document.assets.map((a) => (
            <div
              key={a.id}
              className={`asset-card ${selectedAssetId === a.id ? "selected" : ""} ${a.missing ? "missing" : ""}`}
              onClick={() => selectAsset(a.id)}
              data-testid={`asset-${a.id}`}
            >
              {a.missing && (
                <span className="asset-badge-missing">
                  <FileWarning size={10} /> 缺失
                </span>
              )}
              <div className="asset-thumb">
                {a.kind === "image" ? (
                  urls[a.id] ? (
                    <img src={urls[a.id]} alt={a.fileName} />
                  ) : (
                    <ImageIcon size={18} color="var(--text-2)" />
                  )
                ) : (
                  <AudioLines size={18} color="var(--text-2)" />
                )}
              </div>
              <div className="asset-name" title={a.fileName}>
                {a.fileName}
              </div>
              <div className="asset-meta">
                {a.kind === "image"
                  ? `${a.width ?? "?"}×${a.height ?? "?"}`
                  : `${((a.durationMs ?? 0) / 1000).toFixed(1)}s`}
                {" · "}
                {a.hash.slice(0, 8)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
