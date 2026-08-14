import { Diamond, FileWarning } from "lucide-react";
import { useStore } from "../state/store";
import type { Clip, Scene, StudioProject } from "../domain/types";
import { findAsset } from "../domain/types";
import {
  AddKeyframeCommand,
  RemoveAssetCommand,
  RemoveKeyframeCommand,
  SetActionsCommand,
  SetClipPropsCommand,
  SetEffectCommand,
  SetSceneDurationCommand,
  SetSubtitleTextCommand,
  UpdateKeyframeCommand,
} from "../domain/commands";
import { isKeyframeablePath } from "../domain/schema";
import { getClipProp } from "../domain/commands";
import { Tooltip } from "./ui/Tooltip";

/** 属性面板：根据选中对象显示可编辑参数。 */

interface RowProps {
  label: string;
  path: string;
  value: number | string | boolean;
  onChange: (v: number | string | boolean) => void;
  step?: number;
  min?: number;
  max?: number;
  sceneId: string;
  clip: Clip;
}

function NumberRow({ label, path, value, onChange, step, min, max, sceneId, clip }: RowProps) {
  const playhead = useStore((s) => s.playhead);
  const localFrame = playhead - clip.start;
  const inClip = localFrame >= 0 && localFrame < clip.duration;
  const keyframable = isKeyframeablePath(clip, path);
  const hasKfAt = clip.keyframes.some((k) => k.frame === localFrame && k.path === path);
  const kfPathExists = clip.keyframes.some((k) => k.path === path);

  const toggleKeyframe = () => {
    const store = useStore.getState();
    if (!store.document) return;
    if (hasKfAt) {
      const kf = clip.keyframes.find((k) => k.frame === localFrame && k.path === path)!;
      store.executeCommand(new RemoveKeyframeCommand(sceneId, clip.id, kf));
    } else {
      store.executeCommand(
        new AddKeyframeCommand(sceneId, clip.id, {
          frame: localFrame,
          path,
          value: typeof value === "number" ? value : Number(value),
          easing: { type: "linear" },
        }),
      );
    }
  };

  return (
    <div className="prop-row">
      <label>{label}</label>
      <input
        type="number"
        step={step ?? 1}
        min={min}
        max={max}
        value={Number.isFinite(value as number) ? (value as number) : 0}
        onChange={(e) => {
          const v = e.target.value === "" ? 0 : Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        data-testid={`prop-${path}`}
      />
      {keyframable && inClip && (
        <Tooltip tip={hasKfAt ? "删除本帧关键帧" : kfPathExists ? "本帧添加关键帧" : "添加关键帧"}>
          <button
            type="button"
            className={`icon-btn kf-btn ${hasKfAt ? "active" : ""}`}
            onClick={toggleKeyframe}
            aria-label={`${label} 关键帧`}
            data-testid={`kf-${path}`}
          >
            <Diamond size={12} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function PropertiesPanel() {
  const document = useStore((s) => s.document);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const selectAsset = useStore((s) => s.selectAsset);

  if (!document) return null;
  const scene = document.scenes.find((s) => s.id === activeSceneId) ?? document.scenes[0];
  const clip = selectedClipId ? findClipById(scene, selectedClipId) : undefined;
  const asset = selectedAssetId ? findAsset(document, selectedAssetId) : undefined;
  if (!clip && !asset) return <SceneProps scene={scene} doc={document} />;

  const store = useStore.getState();
  const exec = (cmd: Parameters<typeof store.executeCommand>[0]) => store.executeCommand(cmd);

  const commit = (path: string, value: number | string | boolean | number[]) => {
    if (!clip) return;
    const old = getClipProp(clip, path);
    exec(new SetClipPropsCommand(scene.id, clip.id, path, old, value));
  };

  return (
    <div className="props-panel" data-testid="props-panel">
      {clip && (
        <>
          <div className="panel-title">
            <span>片段 · {clip.name}</span>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{clip.type}</span>
          </div>

          {clip.type === "image" && (
            <>
              <div className="panel-section">
                <div className="panel-title">变换</div>
                <NumberRow label="X" path="props.x" value={clip.props.x} onChange={(v) => commit("props.x", v as number)} sceneId={scene.id} clip={clip} />
                <NumberRow label="Y" path="props.y" value={clip.props.y} onChange={(v) => commit("props.y", v as number)} sceneId={scene.id} clip={clip} />
                <NumberRow label="缩放 X" path="props.scaleX" value={clip.props.scaleX} onChange={(v) => commit("props.scaleX", v as number)} step={0.05} sceneId={scene.id} clip={clip} />
                <NumberRow label="缩放 Y" path="props.scaleY" value={clip.props.scaleY} onChange={(v) => commit("props.scaleY", v as number)} step={0.05} sceneId={scene.id} clip={clip} />
                <NumberRow label="旋转°" path="props.rotation" value={clip.props.rotation} onChange={(v) => commit("props.rotation", v as number)} sceneId={scene.id} clip={clip} />
                <NumberRow label="不透明度" path="props.opacity" value={clip.props.opacity} onChange={(v) => commit("props.opacity", Math.max(0, Math.min(1, v as number)))} step={0.01} min={0} max={1} sceneId={scene.id} clip={clip} />
                <NumberRow label="模糊" path="props.blur" value={clip.props.blur} onChange={(v) => commit("props.blur", v as number)} step={1} min={0} sceneId={scene.id} clip={clip} />
              </div>
              <div className="panel-section">
                <div className="panel-title">颜色 / 贴图</div>
                {(["r", "g", "b"] as const).map((ch, i) => (
                  <div className="prop-row" key={ch}>
                    <label>色调 {ch.toUpperCase()}</label>
                    <input
                      type="number"
                      min={0}
                      max={255}
                      value={clip.props.tint[i]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const tint: [number, number, number] = [...clip.props.tint];
                        tint[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, v)) : 0;
                        commit("props.tint", tint);
                      }}
                    />
                  </div>
                ))}
                <div className="prop-row">
                  <label>水平翻转</label>
                  <input
                    type="checkbox"
                    checked={clip.props.flipX}
                    onChange={(e) => commit("props.flipX", e.target.checked)}
                  />
                </div>
                <div className="prop-row">
                  <label>贴图</label>
                  <select
                    value={clip.assetId}
                    onChange={(e) => {
                      // 贴图切换（表情切换）：有 assetId 关键帧时写关键帧，否则写静态值
                      const localFrame = store.playhead - clip.start;
                      if (clip.keyframes.some((k) => k.path === "assetId")) {
                        const kfIndex = clip.keyframes.findIndex((k) => k.frame === localFrame && k.path === "assetId");
                        if (kfIndex >= 0) {
                          const oldKf = clip.keyframes[kfIndex];
                          exec(new UpdateKeyframeCommand(scene.id, clip.id, oldKf, { ...oldKf, value: e.target.value }));
                        } else {
                          exec(new AddKeyframeCommand(scene.id, clip.id, {
                            frame: localFrame,
                            path: "assetId",
                            value: e.target.value,
                            easing: { type: "linear" },
                          }));
                        }
                      } else {
                        commit("assetId", e.target.value);
                      }
                    }}
                  >
                    {document.assets.filter((a) => a.kind === "image").map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.fileName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="panel-section">
                <div className="panel-title">动作</div>
                {(["enter", "idle", "exit"] as const).map((k) => (
                  <div className="prop-row" key={k}>
                    <label>{k === "enter" ? "进入" : k === "idle" ? "待机" : "离开"}</label>
                    <select
                      value={clip.actions[k]}
                      onChange={(e) => {
                        const actions = { ...clip.actions, [k]: e.target.value } as typeof clip.actions;
                        exec(new SetActionsCommand(scene.id, clip.id, clip.actions, actions));
                      }}
                    >
                      {k === "enter" &&
                        ["none", "fadeIn", "slideInLeft", "slideInRight", "zoomIn"].map((v) => <option key={v} value={v}>{v}</option>)}
                      {k === "idle" &&
                        ["none", "sway", "shake", "jump", "pulse", "flashWhite"].map((v) => <option key={v} value={v}>{v}</option>)}
                      {k === "exit" &&
                        ["none", "fadeOut", "slideOutLeft", "slideOutRight", "zoomOut"].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          {clip.type === "subtitle" && (
            <div className="panel-section">
              <div className="panel-title">字幕文本</div>
              <div className="prop-row">
                <textarea
                  rows={3}
                  style={{ flex: 1, resize: "vertical" }}
                  value={clip.text}
                  onChange={(e) => exec(new SetSubtitleTextCommand(scene.id, clip.id, clip.text, e.target.value))}
                />
              </div>
              <NumberRow label="X" path="x" value={clip.x} onChange={(v) => commit("x", v as number)} sceneId={scene.id} clip={clip} />
              <NumberRow label="Y" path="y" value={clip.y} onChange={(v) => commit("y", v as number)} sceneId={scene.id} clip={clip} />
              <NumberRow label="字号" path="fontSize" value={clip.fontSize} onChange={(v) => commit("fontSize", v as number)} step={1} min={8} sceneId={scene.id} clip={clip} />
              <NumberRow label="描边" path="outlineWidth" value={clip.outlineWidth} onChange={(v) => commit("outlineWidth", v as number)} step={1} min={0} sceneId={scene.id} clip={clip} />
              <NumberRow label="不透明度" path="opacity" value={clip.opacity} onChange={(v) => commit("opacity", Math.max(0, Math.min(1, v as number)))} step={0.01} min={0} max={1} sceneId={scene.id} clip={clip} />
              <div className="prop-row">
                <label>对齐</label>
                <select value={clip.align} onChange={(e) => commit("align", e.target.value)}>
                  <option value="left">左</option>
                  <option value="center">中</option>
                  <option value="right">右</option>
                </select>
              </div>
              <div className="prop-row">
                <label>颜色</label>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(clip.color) ? clip.color : "#ffffff"}
                  onChange={(e) => commit("color", e.target.value)}
                  style={{ flex: 1, height: 26, background: "var(--bg-0)", border: "1px solid var(--border)", borderRadius: 4 }}
                />
              </div>
            </div>
          )}

          {clip.type === "audio" && (
            <div className="panel-section">
              <div className="panel-title">音频</div>
              <NumberRow label="音量" path="volume" value={clip.volume} onChange={(v) => commit("volume", Math.max(0, Math.min(1, v as number)))} step={0.01} min={0} max={1} sceneId={scene.id} clip={clip} />
              <NumberRow label="淡入(帧)" path="fadeInFrames" value={clip.fadeInFrames} onChange={(v) => commit("fadeInFrames", Math.max(0, v as number))} step={1} min={0} sceneId={scene.id} clip={clip} />
              <NumberRow label="淡出(帧)" path="fadeOutFrames" value={clip.fadeOutFrames} onChange={(v) => commit("fadeOutFrames", Math.max(0, v as number))} step={1} min={0} sceneId={scene.id} clip={clip} />
            </div>
          )}

          {clip.type === "camera" && (
            <div className="panel-section">
              <div className="panel-title">镜头</div>
              <NumberRow label="X" path="props.x" value={clip.props.x} onChange={(v) => commit("props.x", v as number)} sceneId={scene.id} clip={clip} />
              <NumberRow label="Y" path="props.y" value={clip.props.y} onChange={(v) => commit("props.y", v as number)} sceneId={scene.id} clip={clip} />
              <NumberRow label="缩放" path="zoom" value={clip.props.zoom} onChange={(v) => commit("zoom", Math.max(0.1, v as number))} step={0.05} sceneId={scene.id} clip={clip} />
            </div>
          )}

          {clip.type === "effect" && (
            <div className="panel-section">
              <div className="panel-title">特效</div>
              <div className="prop-row">
                <label>类型</label>
                <select
                  value={clip.effect.type}
                  onChange={(e) => {
                    const type = e.target.value as typeof clip.effect.type;
                    const params: Record<string, number | string | number[]> =
                      type === "vignette" ? { strength: 0.5, softness: 0.6 }
                      : type === "flash" ? { alpha: 0.9 }
                      : type === "shake" ? { amplitude: 8, frequency: 30 }
                      : type === "tint" ? { color: [255, 200, 120], amount: 0.4 }
                      : type === "blur" ? { radius: 8 }
                      : { color: "#000000", alpha: 0.5 };
                    exec(new SetEffectCommand(scene.id, clip.id, clip.effect, { type, params }));
                  }}
                >
                  <option value="vignette">暗角</option>
                  <option value="flash">闪白</option>
                  <option value="shake">震动</option>
                  <option value="tint">色调</option>
                  <option value="blur">模糊</option>
                  <option value="transition">转场</option>
                </select>
              </div>
              {Object.entries(clip.effect.params).map(([k, v]) => {
                if (typeof v === "number") {
                  return (
                    <NumberRow
                      key={k}
                      label={k}
                      path={`effect.params.${k}`}
                      value={v}
                      onChange={(nv) => {
                        const params = { ...clip.effect.params, [k]: nv };
                        exec(new SetEffectCommand(scene.id, clip.id, clip.effect, { ...clip.effect, params }));
                      }}
                      step={0.05}
                      sceneId={scene.id}
                      clip={clip}
                    />
                  );
                }
                if (Array.isArray(v)) {
                  return (
                    <div className="prop-row" key={k}>
                      <label>{k}</label>
                      <input
                        type="color"
                        value={`rgb(${v[0]},${v[1]},${v[2]})`}
                        onChange={(e) => {
                          const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(e.target.value);
                          if (!m) return;
                          const params = { ...clip.effect.params, [k]: [Number(m[1]), Number(m[2]), Number(m[3])] };
                          exec(new SetEffectCommand(scene.id, clip.id, clip.effect, { ...clip.effect, params }));
                        }}
                      />
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </>
      )}

      {asset && !clip && (
        <>
          <div className="panel-title">素材</div>
          <div className="panel-section" style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="prop-row">
              <label>文件名</label>
              <span style={{ fontSize: 12, color: "var(--text-1)", wordBreak: "break-all" }}>{asset.fileName}</span>
            </div>
            <div className="prop-row">
              <label>类型</label>
              <span style={{ fontSize: 12, color: "var(--text-1)" }}>{asset.kind}</span>
            </div>
            <div className="prop-row">
              <label>尺寸</label>
              <span style={{ fontSize: 12, color: "var(--text-1)" }}>
                {asset.width && asset.height ? `${asset.width}×${asset.height}` : "—"}
              </span>
            </div>
            <div className="prop-row">
              <label>时长</label>
              <span style={{ fontSize: 12, color: "var(--text-1)" }}>
                {asset.durationMs ? `${(asset.durationMs / 1000).toFixed(2)}s` : "—"}
              </span>
            </div>
            <div className="prop-row">
              <label>哈希</label>
              <span style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>{asset.hash.slice(0, 20)}…</span>
            </div>
            {asset.missing && (
              <div className="prop-row">
                <button
                  type="button"
                  className="danger"
                  style={{ flex: 1 }}
                  onClick={() => void useStore.getState().relocateMissingAsset(asset.id)}
                >
                  <FileWarning size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                  重新定位素材
                </button>
              </div>
            )}
            <div className="prop-row">
              <button
                type="button"
                style={{ flex: 1 }}
                onClick={() => {
                  useStore.getState().executeCommand(new RemoveAssetCommand(asset));
                  selectAsset(null);
                }}
              >
                从项目移除素材
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SceneProps({ scene, doc }: { scene: Scene; doc: StudioProject }) {
  const store = useStore;
  return (
    <div className="props-panel" data-testid="props-panel">
      <div className="panel-title">场景 · {scene.name}</div>
      <div className="panel-section">
        <div className="panel-title">时长</div>
        <div className="prop-row">
          <label>帧数</label>
          <input
            type="number"
            min={1}
            value={scene.durationFrames}
            onChange={(e) => {
              const v = Math.max(1, Math.floor(Number(e.target.value) || 1));
              store.getState().executeCommand(new SetSceneDurationCommand(scene.id, scene.durationFrames, v));
            }}
          />
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>
            = {((scene.durationFrames / (doc.canvas.fps || 30)) / 60).toFixed(2)} 分钟
          </span>
        </div>
      </div>
      <div className="panel-section">
        <div className="panel-title">画布</div>
        <div className="prop-row">
          <label>分辨率</label>
          <span style={{ fontSize: 12, color: "var(--text-1)" }}>
            {doc.canvas.width}×{doc.canvas.height} @ {doc.canvas.fps}fps
          </span>
        </div>
      </div>
      <div className="empty-hint">
        在时间轴选中片段、在素材库选中素材后可编辑属性。
      </div>
    </div>
  );
}

function findClipById(scene: Scene, clipId: string): Clip | undefined {
  for (const t of scene.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) return c;
  }
  return undefined;
}

// 供画布拖拽等场景使用的属性提交（含关键帧回退）
export function commitPropValue(
  scene: Scene,
  clip: Clip,
  path: string,
  value: number | string,
  playhead: number,
): void {
  const store = useStore.getState();
  const localFrame = playhead - clip.start;
  const kfIndex = clip.keyframes.findIndex((k) => k.frame === localFrame && k.path === path);
  if (kfIndex >= 0) {
    const oldKf = clip.keyframes[kfIndex];
    store.executeCommand(new UpdateKeyframeCommand(scene.id, clip.id, oldKf, { ...oldKf, value }));
  } else if (clip.keyframes.some((k) => k.path === path)) {
    store.executeCommand(new AddKeyframeCommand(scene.id, clip.id, { frame: localFrame, path, value, easing: { type: "linear" } }));
  } else {
    const old = getClipProp(clip, path);
    store.executeCommand(new SetClipPropsCommand(scene.id, clip.id, path, old, value));
  }
}
