/**
 * ⚠️ DEV 专用时间轴求值替身（BrowserFallbackEvaluator）。
 *
 * 仅用于「无 Rust 后端的浏览器开发模式」与 Playwright UI 流程测试：
 * - 它不是产品求值器。产品中预览与离线渲染的求值唯一实现在 Rust（studio-core::timeline），
 *   通过 IPC 返回 SceneDescriptor；本文件与 Rust 求值器输出同一契约，但实现为独立子集。
 * - 本文件只存在于开发构建（import.meta.env.DEV 由 Vite 注入，产品打包后不可达）。
 * - UI 自动化测试不得断言本替身的数值正确性；数值正确性由 cargo test 与离线导出验证负责。
 *
 * 语义目标：与 docs/PROJECT_FORMAT.md §4 保持一致。
 */
import { applyEasing, lerp } from "../domain/easing";
import { ACTION_ENTER_DURATION, ACTION_EXIT_DURATION } from "../domain/types";
import type { Clip, Keyframe, Scene, StudioProject } from "../domain/types";
import { buildLineSequence, lineSpanAt } from "../domain/graph";
import type { AudioDescriptor, EffectDescriptor, LayerDescriptor, SceneDescriptor, SubtitleDescriptor } from "../shared/descriptor";

export function isDevEvaluatorAvailable(): boolean {
  return import.meta.env.DEV === true;
}

/** 确定性伪随机（帧号做种），与 Rust 端语义一致（同为均匀抖动，数值不必逐位一致）。 */
function jitter(frame: number, seed: number): number {
  let h = (frame * 374761393 + seed * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) & 0xffff) / 0xffff; // 0..1
}

function valueAt(keyframes: Keyframe[], path: string, lf: number, fallback: number | string): number | string {
  const kfs = keyframes.filter((k) => k.path === path).sort((a, b) => a.frame - b.frame);
  if (kfs.length === 0) return fallback;
  if (kfs.length === 1) return kfs[0].value;
  if (lf <= kfs[0].frame) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (lf >= last.frame) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (lf >= a.frame && lf <= b.frame) {
      if (typeof a.value === "string" || typeof b.value === "string") {
        // 离散属性：到 b 的帧号即切换
        return lf >= b.frame ? b.value : a.value;
      }
      const u = b.frame === a.frame ? 1 : (lf - a.frame) / (b.frame - a.frame);
      const e = applyEasing(u, b.easing);
      return lerp(a.value as number, b.value as number, e);
    }
  }
  return last.value;
}

function num(kfs: Keyframe[], path: string, lf: number, fallback: number): number {
  const v = valueAt(kfs, path, lf, fallback);
  return typeof v === "number" ? v : fallback;
}

function str(kfs: Keyframe[], path: string, lf: number, fallback: string): string {
  const v = valueAt(kfs, path, lf, fallback);
  return typeof v === "string" ? v : fallback;
}

export function evaluateFrame(project: StudioProject, sceneId: string, frame: number): SceneDescriptor {
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  const fps = project.canvas.fps;
  const W = project.canvas.width;
  const H = project.canvas.height;
  const frameClamped = Math.max(0, Math.min(frame, scene.durationFrames - 1));

  const camera = { x: 0, y: 0, zoom: 1 };
  const layers: LayerDescriptor[] = [];
  const subtitles: SubtitleDescriptor[] = [];
  const effects: EffectDescriptor[] = [];
  const audio: AudioDescriptor[] = [];

  for (const track of scene.tracks) {
    for (const clip of track.clips) {
      const lf = frameClamped - clip.start;
      if (lf < 0 || lf >= clip.duration) continue;
      switch (clip.type) {
        case "image": {
          const kfs = clip.keyframes;
          const p = clip.props;
          let x = num(kfs, "props.x", lf, p.x);
          let y = num(kfs, "props.y", lf, p.y);
          let sx = num(kfs, "props.scaleX", lf, p.scaleX);
          let sy = num(kfs, "props.scaleY", lf, p.scaleY);
          let rotation = num(kfs, "props.rotation", lf, p.rotation);
          let opacity = num(kfs, "props.opacity", lf, p.opacity);
          let blur = num(kfs, "props.blur", lf, p.blur);
          let flipX = (valueAt(kfs, "props.flipX", lf, p.flipX ? 1 : 0) as number) > 0.5;
          const assetId = str(kfs, "assetId", lf, clip.assetId);
          let flash = 0;

          // 动作（语义与 Rust 端一致，见 PROJECT_FORMAT §4.5）
          const a = clip.actions;
          const dur = clip.duration;
          if (a.enter !== "none" && lf < ACTION_ENTER_DURATION) {
            const u = lf / ACTION_ENTER_DURATION;
            const e = applyEasing(u, { type: "easeInOut" });
            if (a.enter === "fadeIn") opacity *= e;
            else if (a.enter === "slideInLeft") x = lerp(x - 1400, x, e);
            else if (a.enter === "slideInRight") x = lerp(x + 1400, x, e);
            else if (a.enter === "zoomIn") {
              sx = lerp(sx * 0.6, sx, e);
              sy = lerp(sy * 0.6, sy, e);
            }
          }
          if (a.exit !== "none" && lf >= dur - ACTION_EXIT_DURATION) {
            const u = (lf - (dur - ACTION_EXIT_DURATION)) / ACTION_EXIT_DURATION;
            const e = applyEasing(u, { type: "easeInOut" });
            if (a.exit === "fadeOut") opacity *= 1 - e;
            else if (a.exit === "slideOutLeft") x = lerp(x, x - 1400, e);
            else if (a.exit === "slideOutRight") x = lerp(x, x + 1400, e);
            else if (a.exit === "zoomOut") {
              sx = lerp(sx, sx * 0.6, e);
              sy = lerp(sy, sy * 0.6, e);
            }
          }
          if (a.idle !== "none") {
            if (a.idle === "sway") x += Math.sin((2 * Math.PI * lf) / 60) * 5;
            else if (a.idle === "shake") {
              x += (jitter(lf, 1) - 0.5) * 6;
              y += (jitter(lf, 2) - 0.5) * 6;
            } else if (a.idle === "jump") {
              const u = (lf % 30) / 30;
              y -= Math.sin(Math.PI * u) * 40;
            } else if (a.idle === "pulse") {
              const m = 1 + 0.08 * Math.sin((2 * Math.PI * lf) / 30);
              sx *= m;
              sy *= m;
            } else if (a.idle === "flashWhite") {
              flash = Math.max(flash, Math.sin((2 * Math.PI * lf) / 20) * 0.5 + 0.5);
            }
          }

          layers.push({
            id: clip.id,
            kind: "image",
            assetId,
            x,
            y,
            scaleX: sx,
            scaleY: sy,
            rotation,
            opacity: clamp01(opacity),
            tint: p.tint,
            blur,
            crop: p.crop,
            flipX,
            flash,
          });
          break;
        }
        case "subtitle": {
          const kfs = clip.keyframes;
          subtitles.push({
            id: clip.id,
            text: clip.text,
            x: num(kfs, "x", lf, clip.x),
            y: num(kfs, "y", lf, clip.y),
            fontSize: num(kfs, "fontSize", lf, clip.fontSize),
            color: clip.color,
            align: clip.align,
            outlineWidth: num(kfs, "outlineWidth", lf, clip.outlineWidth),
            opacity: clamp01(num(kfs, "opacity", lf, clip.opacity)),
          });
          break;
        }
        case "audio": {
          const kfs = clip.keyframes;
          let vol = num(kfs, "volume", lf, clip.volume);
          vol = applyFade(vol, lf, clip.duration, clip.fadeInFrames, clip.fadeOutFrames);
          audio.push({
            assetId: clip.assetId,
            startFrame: clip.start,
            durationFrames: clip.duration,
            volume: clamp01(vol),
            fadeInFrames: clip.fadeInFrames,
            fadeOutFrames: clip.fadeOutFrames,
          });
          break;
        }
        case "camera": {
          const kfs = clip.keyframes;
          camera.x = num(kfs, "props.x", lf, clip.props.x);
          camera.y = num(kfs, "props.y", lf, clip.props.y);
          camera.zoom = num(kfs, "zoom", lf, clip.props.zoom);
          break;
        }
        case "effect": {
          const kfs = clip.keyframes;
          const params: Record<string, number | string | number[]> = {};
          for (const [k, v] of Object.entries(clip.effect.params)) {
            if (typeof v === "number") params[k] = num(kfs, `effect.params.${k}`, lf, v);
            else params[k] = v;
          }
          const d: EffectDescriptor = { type: clip.effect.type, params };
          if (clip.effect.type === "shake") {
            const amp = typeof params.amplitude === "number" ? params.amplitude : 0;
            camera.x += (jitter(frameClamped, 7) - 0.5) * 2 * amp;
            camera.y += (jitter(frameClamped, 8) - 0.5) * 2 * amp;
          }
          effects.push(d);
          break;
        }
      }
    }
  }

  return {
    frame: frameClamped,
    width: W,
    height: H,
    fps,
    durationFrames: scene.durationFrames,
    camera,
    layers,
    subtitles,
    effects,
    audio,
  };
}

function applyFade(vol: number, lf: number, duration: number, fadeIn: number, fadeOut: number): number {
  let v = vol;
  if (fadeIn > 0 && lf < fadeIn) v *= lf / fadeIn;
  if (fadeOut > 0 && lf >= duration - fadeOut) v *= Math.max(0, (duration - lf) / fadeOut);
  return v;
}

/**
 * 剧本节点图求值（DEV 替身；产品实现为 Rust graph.rs，语义一致）：
 * 按 path 展开演出行序列，定位 frame 所在行，生成 SceneDescriptor。
 */
export function evaluateGraphFrame(
  project: StudioProject,
  path: string[],
  frame: number,
): SceneDescriptor {
  const graph = project.script;
  const W = project.canvas.width;
  const H = project.canvas.height;
  const fps = project.canvas.fps;
  const spans = buildLineSequence(graph, path);
  const total = spans.reduce((acc, s) => acc + s.durationFrames, 0);
  const frameClamped = Math.max(0, Math.min(frame, Math.max(0, total - 1)));
  const span = lineSpanAt(spans, frameClamped);

  const layers: LayerDescriptor[] = [];
  const subtitles: SubtitleDescriptor[] = [];
  const effects: EffectDescriptor[] = [];
  const audio: AudioDescriptor[] = [];
  const camera = { x: 0, y: 0, zoom: 1 };

  if (!span) {
    return { frame: frameClamped, width: W, height: H, fps, durationFrames: total, camera, layers, subtitles, effects, audio };
  }
  const lf = frameClamped - span.startFrame;
  const line = span.line;

  // 背景 / BGM 状态继承：取当前行及之前最近的设置
  let bgAssetId: string | null = null;
  let bgEffect = "none";
  let bgmAssetId: string | null = null;
  for (const s of spans) {
    if (s.startFrame > frameClamped) break;
    if (s.line.bgAssetId) {
      bgAssetId = s.line.bgAssetId;
      bgEffect = s.line.bgEffect;
    }
    if (s.line.bgmAssetId) bgmAssetId = s.line.bgmAssetId;
  }

  // 背景层
  if (bgAssetId) {
    layers.push({
      id: `bg_${span.nodeId}_${line.id}`,
      kind: "image",
      assetId: bgAssetId,
      x: W / 2,
      y: H / 2,
      scaleX: Math.max(W / 1920, H / 1080),
      scaleY: Math.max(W / 1920, H / 1080),
      rotation: 0,
      opacity: 1,
      tint: [255, 255, 255],
      blur: 0,
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
      flipX: false,
      flash: 0,
    });
  }

  // 角色层（按槽位摆放：0 左 / 1 中 / 2 右）
  const slotX = [W * 0.26, W * 0.5, W * 0.74];
  for (const ch of line.characters) {
    const sway = ch.action === "sway" ? Math.sin((2 * Math.PI * lf) / 60) * 5 : 0;
    const shake = ch.action === "shake" ? (jitter(frameClamped, 1) - 0.5) * 6 : 0;
    const jump = ch.action === "jump" ? -Math.sin(Math.PI * ((lf % 30) / 30)) * 40 : 0;
    const pulse =
      ch.action === "pulse" ? 1 + 0.08 * Math.sin((2 * Math.PI * lf) / 30) : 1;
    const flash = ch.action === "flashWhite" ? Math.sin((2 * Math.PI * lf) / 20) * 0.5 + 0.5 : 0;
    layers.push({
      id: `char_${ch.assetId}_${span.nodeId}`,
      kind: "image",
      assetId: ch.assetId,
      x: slotX[ch.slot] ?? slotX[1],
      y: H * 0.58,
      scaleX: (0.9 * ch.scale * pulse) / (720 / H),
      scaleY: (0.9 * ch.scale * pulse) / (720 / H),
      rotation: 0,
      opacity: 1,
      tint: [255, 255, 255],
      blur: 0,
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
      flipX: false,
      flash,
    });
    void sway;
    void shake;
    void jump;
  }

  // 字幕（说话人 + 台词；地点文本作为副标题）
  const speakerLine = line.speaker ? `${line.speaker}：${line.text}` : line.text;
  const subtitleText = line.placeText ? `${line.placeText}\n${speakerLine}` : speakerLine;
  if (line.text) {
    subtitles.push({
      id: `sub_${line.id}`,
      text: subtitleText,
      x: W / 2,
      y: H - 130,
      fontSize: 52,
      color: "#ffffff",
      align: "center",
      outlineWidth: 4,
      opacity: 1,
    });
  }

  // 转场（行首 fade：黑场淡入）
  if (line.transition === "fade" && lf < ACTION_ENTER_DURATION) {
    const alpha = 1 - applyEasing(lf / ACTION_ENTER_DURATION, { type: "easeInOut" });
    effects.push({ type: "transition", params: { color: "#000000", alpha } });
  }

  // 背景特效
  if (bgEffect === "blur") {
    effects.push({ type: "blur", params: { radius: 8 } });
  }

  // 音频：BGM 持续到结尾；语音/音效在当前行区间
  if (bgmAssetId) {
    audio.push({
      assetId: bgmAssetId,
      startFrame: 0,
      durationFrames: total,
      volume: 0.7,
      fadeInFrames: 30,
      fadeOutFrames: 60,
    });
  }
  if (line.voiceAssetId) {
    audio.push({
      assetId: line.voiceAssetId,
      startFrame: span.startFrame,
      durationFrames: span.durationFrames,
      volume: 0.9,
      fadeInFrames: 2,
      fadeOutFrames: 6,
    });
  }
  if (line.soundAssetId) {
    audio.push({
      assetId: line.soundAssetId,
      startFrame: span.startFrame,
      durationFrames: span.durationFrames,
      volume: 0.85,
      fadeInFrames: 2,
      fadeOutFrames: 6,
    });
  }

  return {
    frame: frameClamped,
    width: W,
    height: H,
    fps,
    durationFrames: total,
    camera,
    layers,
    subtitles,
    effects,
    audio,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 供 UI 层获取当前场景（未找到时回退第一个场景）。 */
export function resolveScene(project: StudioProject, sceneId: string | null): Scene | null {
  if (!project) return null;
  return project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0] ?? null;
}

export function isClipActive(clip: Clip, frame: number): boolean {
  return frame >= clip.start && frame < clip.start + clip.duration;
}
