import { Diamond, FileWarning, Plus, Trash2 } from "lucide-react";
import { useStore } from "../state/store";
import type { Clip, GraphNode, Scene, ScriptLine, StudioProject } from "../domain/types";
import { findAsset } from "../domain/types";
import {
  AddKeyframeCommand,
  AddScriptLineCommand,
  RemoveAssetCommand,
  RemoveGraphNodeCommand,
  RemoveKeyframeCommand,
  RemoveScriptLineCommand,
  SetActionsCommand,
  SetClipPropsCommand,
  SetEffectCommand,
  SetEntryNodeCommand,
  SetSubtitleTextCommand,
  UpdateGraphNodeCommand,
  UpdateKeyframeCommand,
  UpdateScriptLineCommand,
} from "../domain/commands";
import { isKeyframeablePath } from "../domain/schema";
import { getClipProp } from "../domain/commands";
import { newId } from "../domain/id";
import { Tooltip } from "./ui/Tooltip";

/** 属性面板：根据选中对象（节点/演出行/片段/素材）显示可编辑参数。 */

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
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedLineId = useStore((s) => s.selectedLineId);
  const selectAsset = useStore((s) => s.selectAsset);

  if (!document) return null;
  const scene = document.scenes.find((s) => s.id === activeSceneId) ?? document.scenes[0];

  // 节点/行编辑优先（v2 剧情编辑主路径）
  const node = selectedNodeId ? document.script.nodes.find((n) => n.id === selectedNodeId) : undefined;
  if (node) {
    if (node.type === "script" && selectedLineId) {
      const line = node.lines?.find((l) => l.id === selectedLineId);
      if (line) return <LineProps node={node} line={line} doc={document} />;
    }
    return <NodeProps node={node} doc={document} />;
  }

  const clip = selectedClipId ? findClipById(scene, selectedClipId) : undefined;
  const asset = selectedAssetId ? findAsset(document, selectedAssetId) : undefined;
  if (!clip && !asset) return <SceneProps doc={document} />;

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

// ---------------------------------------------------------------------------
// 节点编辑（v2 主路径）
// ---------------------------------------------------------------------------

function NodeProps({ node, doc }: { node: GraphNode; doc: StudioProject }) {
  const store = useStore;
  const update = (next: GraphNode) => {
    store.getState().executeCommand(new UpdateGraphNodeCommand(node.id, node, next));
  };

  const removeNode = () => {
    const ok = window.confirm(`删除节点「${node.title}」？`);
    if (!ok) return;
    store.getState().executeCommand(new RemoveGraphNodeCommand(node));
    store.getState().selectNode(null);
  };

  const nodeOptions = doc.script.nodes.filter((n) => n.id !== node.id);

  return (
    <div className="props-panel" data-testid="props-panel">
      <div className="panel-title">
        <span>剧本节点 · {node.type}</span>
        <Tooltip tip="删除节点">
          <button type="button" className="icon-btn" onClick={removeNode} aria-label="删除节点">
            <Trash2 size={13} />
          </button>
        </Tooltip>
      </div>

      <div className="panel-section">
        <div className="panel-title">基本信息</div>
        <div className="prop-row">
          <label>标题</label>
          <input
            type="text"
            value={node.title}
            onChange={(e) => update({ ...node, title: e.target.value })}
            data-testid="node-title"
          />
        </div>
        {node.type === "entry" && (
          <div className="prop-row">
            <label>副标题</label>
            <input type="text" value={node.header ?? ""} onChange={(e) => update({ ...node, header: e.target.value })} />
          </div>
        )}
        {node.type === "exit" && (
          <div className="prop-row">
            <label>结局文本</label>
            <input type="text" value={node.endText ?? ""} onChange={(e) => update({ ...node, endText: e.target.value })} />
          </div>
        )}
        {node.type === "entry" && (
          <div className="prop-row">
            <label>剧本入口</label>
            <input
              type="checkbox"
              checked={doc.script.entryNodeId === node.id}
              onChange={(e) => {
                store.getState().executeCommand(new SetEntryNodeCommand(doc.script.entryNodeId, e.target.checked ? node.id : null));
              }}
            />
          </div>
        )}
      </div>

      {node.type === "script" && (
        <div className="panel-section">
          <div className="panel-title">
            <span>演出行（{node.lines?.length ?? 0}）</span>
            <Tooltip tip="添加演出行">
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  const line: ScriptLine = {
                    id: newId("ln"),
                    text: "",
                    speaker: "",
                    clubName: "",
                    characters: [],
                    bgAssetId: null,
                    bgEffect: "none",
                    bgmAssetId: null,
                    voiceAssetId: null,
                    soundAssetId: null,
                    transition: "none",
                    durationFrames: doc.canvas.fps * 4,
                    placeText: "",
                  };
                  store
                    .getState()
                    .executeCommand(new AddScriptLineCommand(node.id, line, node.lines?.length ?? 0));
                  store.getState().selectLine(line.id);
                }}
                aria-label="添加演出行"
              >
                <Plus size={13} />
              </button>
            </Tooltip>
          </div>
          <div className="node-line-list">
            {(node.lines ?? []).map((l, i) => (
              <div
                key={l.id}
                className={`node-line-item ${store.getState().selectedLineId === l.id ? "selected" : ""}`}
                onClick={() => store.getState().selectLine(l.id)}
                data-testid={`line-item-${l.id}`}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-2)" }}>{i + 1}</span>
                <span className="line-text">{l.speaker ? `${l.speaker}：` : ""}{l.text || "（空行）"}</span>
                <span style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
                  {(l.durationFrames / doc.canvas.fps).toFixed(1)}s
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 18, height: 18 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    store.getState().executeCommand(new RemoveScriptLineCommand(node.id, l));
                    store.getState().selectLine(null);
                  }}
                  aria-label="删除演出行"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {node.type === "selection" && (
        <div className="panel-section">
          <div className="panel-title">
            <span>选项（{node.options?.length ?? 0}）</span>
            <Tooltip tip="添加选项">
              <button
                type="button"
                className="icon-btn"
                onClick={() =>
                  update({ ...node, options: [...(node.options ?? []), `选项${(node.options?.length ?? 0) + 1}`] })
                }
                aria-label="添加选项"
              >
                <Plus size={13} />
              </button>
            </Tooltip>
          </div>
          {(node.options ?? []).map((opt, i) => (
            <div className="prop-row" key={i}>
              <label style={{ width: 30 }}>{i + 1}.</label>
              <input
                type="text"
                value={opt}
                onChange={(e) => {
                  const options = [...(node.options ?? [])];
                  options[i] = e.target.value;
                  update({ ...node, options });
                }}
              />
              <select
                value={node.next[i] ?? ""}
                onChange={(e) => {
                  const next = [...node.next];
                  next[i] = e.target.value;
                  update({ ...node, next });
                }}
                title="选项指向的节点"
              >
                <option value="">（选择目标节点）</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.type} · {n.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 18, height: 18 }}
                onClick={() => {
                  const options = [...(node.options ?? [])].filter((_, j) => j !== i);
                  const next = node.next.filter((_, j) => j !== i);
                  update({ ...node, options, next });
                }}
                aria-label="删除选项"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {node.type !== "exit" && (
        <div className="panel-section">
          <div className="panel-title">输出连接</div>
          {(node.next ?? []).map((to, i) => (
            <div className="prop-row" key={i}>
              <label style={{ width: 56 }}>{node.type === "selection" ? `选项 ${i + 1}` : `连接 ${i + 1}`}</label>
              <select
                value={to}
                onChange={(e) => {
                  const next = [...node.next];
                  next[i] = e.target.value;
                  update({ ...node, next });
                }}
              >
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.type} · {n.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 18, height: 18 }}
                onClick={() => update({ ...node, next: node.next.filter((_, j) => j !== i) })}
                aria-label="断开连接"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {node.next.length === 0 && (
            <div style={{ padding: "2px 12px 8px", fontSize: 11, color: "var(--text-2)" }}>
              从节点右侧圆点拖到目标节点建立连接。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 演出行编辑
// ---------------------------------------------------------------------------

function LineProps({ node, line, doc }: { node: GraphNode; line: ScriptLine; doc: StudioProject }) {
  const store = useStore;
  const update = (next: ScriptLine) => {
    store.getState().executeCommand(new UpdateScriptLineCommand(node.id, line, next));
  };
  const imageAssets = doc.assets.filter((a) => a.kind === "image");
  const audioAssets = doc.assets.filter((a) => a.kind === "audio");

  const assetSelect = (value: string | null, onChange: (v: string | null) => void, assets: { id: string; fileName: string }[], placeholder: string) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {assets.map((a) => (
        <option key={a.id} value={a.id}>
          {a.fileName}
        </option>
      ))}
    </select>
  );

  return (
    <div className="props-panel" data-testid="props-panel">
      <div className="panel-title">
        <span>演出行 · {line.text.slice(0, 12) || "（空行）"}</span>
        <button type="button" className="icon-btn" onClick={() => store.getState().selectLine(null)} aria-label="返回节点">
          ← 节点
        </button>
      </div>

      <div className="panel-section">
        <div className="panel-title">台词</div>
        <div className="prop-row">
          <textarea
            rows={3}
            style={{ flex: 1, resize: "vertical" }}
            value={line.text}
            placeholder="台词 / 演出文本"
            onChange={(e) => update({ ...line, text: e.target.value })}
            data-testid="line-text"
          />
        </div>
        <div className="prop-row">
          <label>说话人</label>
          <input type="text" value={line.speaker} onChange={(e) => update({ ...line, speaker: e.target.value })} />
        </div>
        <div className="prop-row">
          <label>社团名</label>
          <input type="text" value={line.clubName} onChange={(e) => update({ ...line, clubName: e.target.value })} placeholder="姓名牌蓝色副标题" />
        </div>
        <div className="prop-row">
          <label>地点</label>
          <input type="text" value={line.placeText} onChange={(e) => update({ ...line, placeText: e.target.value })} />
        </div>
        <div className="prop-row">
          <label>时长</label>
          <input
            type="number"
            min={1}
            value={line.durationFrames}
            onChange={(e) => update({ ...line, durationFrames: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            data-testid="line-duration"
          />
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>
            = {(line.durationFrames / doc.canvas.fps).toFixed(2)}s
          </span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">背景</div>
        <div className="prop-row">
          <label>背景</label>
          {assetSelect(line.bgAssetId, (v) => update({ ...line, bgAssetId: v }), imageAssets, "（保持上一行）")}
        </div>
        <div className="prop-row">
          <label>背景特效</label>
          <select value={line.bgEffect} onChange={(e) => update({ ...line, bgEffect: e.target.value })}>
            <option value="none">无</option>
            <option value="blur">模糊</option>
          </select>
        </div>
        <div className="prop-row">
          <label>转场</label>
          <select value={line.transition} onChange={(e) => update({ ...line, transition: e.target.value })}>
            <option value="none">无</option>
            <option value="fade">淡入</option>
          </select>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">音频</div>
        <div className="prop-row">
          <label>BGM</label>
          {assetSelect(line.bgmAssetId, (v) => update({ ...line, bgmAssetId: v }), audioAssets, "（保持）")}
        </div>
        <div className="prop-row">
          <label>语音</label>
          {assetSelect(line.voiceAssetId, (v) => update({ ...line, voiceAssetId: v }), audioAssets, "（无）")}
        </div>
        <div className="prop-row">
          <label>音效</label>
          {assetSelect(line.soundAssetId, (v) => update({ ...line, soundAssetId: v }), audioAssets, "（无）")}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">
          <span>角色（{line.characters.length}）</span>
          <Tooltip tip="添加角色">
            <button
              type="button"
              className="icon-btn"
              onClick={() =>
                update({
                  ...line,
                  characters: [
                    ...line.characters,
                    { assetId: imageAssets[0]?.id ?? "", slot: 1, action: "none", scale: 1 },
                  ],
                })
              }
              aria-label="添加角色"
            >
              <Plus size={13} />
            </button>
          </Tooltip>
        </div>
        {line.characters.map((ch, i) => (
          <div className="char-row" key={i}>
            <select
              value={ch.assetId}
              onChange={(e) => {
                const characters = [...line.characters];
                characters[i] = { ...ch, assetId: e.target.value };
                update({ ...line, characters });
              }}
              title="角色素材"
            >
              {imageAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fileName}
                </option>
              ))}
            </select>
            <select
              value={ch.slot}
              onChange={(e) => {
                const characters = [...line.characters];
                characters[i] = { ...ch, slot: Number(e.target.value) };
                update({ ...line, characters });
              }}
              title="槽位"
            >
              <option value={0}>左</option>
              <option value={1}>中</option>
              <option value={2}>右</option>
            </select>
            <select
              value={ch.action}
              onChange={(e) => {
                const characters = [...line.characters];
                characters[i] = { ...ch, action: e.target.value };
                update({ ...line, characters });
              }}
              title="动作"
            >
              {["none", "sway", "shake", "jump", "pulse", "flashWhite"].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 18, height: 18 }}
              onClick={() => update({ ...line, characters: line.characters.filter((_, j) => j !== i) })}
              aria-label="移除角色"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneProps({ doc }: { doc: StudioProject }) {
  const store = useStore;
  return (
    <div className="props-panel" data-testid="props-panel">
      <div className="panel-title">项目 · {doc.meta.name}</div>
      <div className="panel-section">
        <div className="panel-title">剧本</div>
        <div className="prop-row">
          <label>节点数</label>
          <span style={{ fontSize: 12, color: "var(--text-1)" }}>{doc.script.nodes.length}</span>
        </div>
        <div className="prop-row">
          <label>演出行数</label>
          <span style={{ fontSize: 12, color: "var(--text-1)" }}>
            {doc.script.nodes.reduce((acc, n) => acc + (n.lines?.length ?? 0), 0)}
          </span>
        </div>
        <div className="prop-row">
          <label>入口</label>
          <span style={{ fontSize: 12, color: "var(--text-1)" }}>
            {doc.script.nodes.find((n) => n.id === doc.script.entryNodeId)?.title ?? "未设置"}
          </span>
        </div>
        <div className="prop-row">
          <label>入口节点</label>
          <select
            value={doc.script.entryNodeId ?? ""}
            onChange={(e) => {
              store.getState().executeCommand(new SetEntryNodeCommand(doc.script.entryNodeId, e.target.value || null));
            }}
          >
            <option value="">（无）</option>
            {doc.script.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.type} · {n.title}
              </option>
            ))}
          </select>
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
        在节点图选中节点编辑剧本；
        <br />
        在素材库选中素材查看详情。
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

// 供画布拖拽等场景使用的属性提交（含关键帧回退；时间轴兼容模式）
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
