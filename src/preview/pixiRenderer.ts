import {
  Application,
  BlurFilter,
  CanvasTextMetrics,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type { RendererAdapter } from "./RendererAdapter";
import type { SceneDescriptor, LayerDescriptor, PresentationDialogue } from "../shared/descriptor";
import { getDialogueCaretHeight, getDialogueCaretOffset, getDialogueCaretWidth, getDialogueLayout } from "./dialogueTypography";
import { resolveLayerAssetUrl } from "./assetUrls";

/**
 * PixiJS 渲染器 —— RendererAdapter 的 WebGL/Canvas 实现。
 * 只负责「按 SceneDescriptor 绘制」；一切求值在 Rust。
 * 编辑器覆盖层（选中框 / 拖拽 / 参考线）由 CanvasView 的 DOM 层负责，不在此实现。
 */
export class PixiRenderer implements RendererAdapter {
  private app: Application | null = null;
  private viewport: Container | null = null;
  private contentRoot: Container | null = null;
  private overlayRoot: Container | null = null;
  private readonly textureCache = new Map<string, Texture>();
  private assetUrls: Readonly<Record<string, string>> = {};
  private layerBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
  private cssW = 0;
  private cssH = 0;
  private vignetteTexture: Texture | null = null;
  private disposed = false;
  private fontFamily = '"SF HarmonyOS Sans", "SF HarmonyOS Sans SC", "Microsoft YaHei", sans-serif';

  async init(container: HTMLElement, width: number, height: number): Promise<void> {
    if (this.app) return;
    this.cssW = width || container.clientWidth || 960;
    this.cssH = height || container.clientHeight || 540;
    const app = new Application();
    await app.init({
      width: this.cssW,
      height: this.cssH,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    container.appendChild(app.canvas);
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";
    app.canvas.style.display = "block";
    this.app = app;
    this.viewport = new Container();
    this.contentRoot = new Container();
    this.overlayRoot = new Container();
    app.stage.addChild(this.viewport);
    this.viewport.addChild(this.contentRoot);
    app.stage.addChild(this.overlayRoot);
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    if (width <= 0 || height <= 0) return;
    this.cssW = width;
    this.cssH = height;
    this.app.renderer.resize(width, height);
  }

  setFontFamily(fontFamily: string): void {
    this.fontFamily = fontFamily;
  }

  async setAssetUrls(assetUrls: Readonly<Record<string, string>>): Promise<void> {
    this.assetUrls = { ...assetUrls };
    const urls = [...new Set(Object.values(assetUrls).filter(Boolean))];
    await Promise.all(urls.map(async (url) => {
      if (this.textureCache.has(url)) return;
      try {
        const texture = await loadImageTexture(url);
        if (!this.disposed) this.textureCache.set(url, texture);
      } catch {
        // 缺失或损坏素材由资源诊断负责，预览使用空纹理降级。
      }
    }));
  }

  renderFrame(d: SceneDescriptor): void {
    if (!this.app || !this.viewport || !this.contentRoot || !this.overlayRoot) return;
    if (this.disposed) return;

    // ---- 相机变换（世界坐标 → CSS 像素） ----
    const baseScale = Math.min(this.cssW / d.width, this.cssH / d.height);
    const zoom = d.camera.zoom;
    this.viewport.scale.set(baseScale * zoom);
    this.viewport.position.set(
      this.cssW / 2 - (d.width / 2 + d.camera.x) * baseScale * zoom,
      this.cssH / 2 - (d.height / 2 + d.camera.y) * baseScale * zoom,
    );
    this.overlayRoot.scale.set(baseScale);

    // ---- 内容（图层 + 字幕） ----
    const content = this.contentRoot;
    content.removeChildren();
    this.layerBounds.clear();
    let fullBlur = 0;
    const tintEffects: { color: number; amount: number }[] = [];

    const orderedLayers = d.layers
      .map((layer, index) => ({ layer, index }))
      .sort((a, b) => (a.layer.zIndex ?? a.index) - (b.layer.zIndex ?? b.index));
    for (const { layer } of orderedLayers) {
      const sp = this.buildLayerSprite(layer);
      content.addChild(sp);
      this.layerBounds.set(layer.id, {
        x: layer.x,
        y: layer.y,
        w: sp.texture.width * Math.abs(sp.scale.x),
        h: sp.texture.height * Math.abs(sp.scale.y),
      });
      if (layer.flash > 0) {
        const rect = new Graphics();
        const tw = sp.texture.width;
        const th = sp.texture.height;
        rect.rect(-tw / 2, -th / 2, tw, th).fill({ color: 0xffffff, alpha: layer.flash });
        rect.position.set(sp.position.x, sp.position.y);
        rect.scale.set(sp.scale.x, sp.scale.y);
        rect.rotation = sp.rotation;
        content.addChild(rect);
      }
    }

    if (d.presentationDialogues.length > 0) {
      for (const dialogue of d.presentationDialogues) this.buildPresentationDialogue(d, dialogue, content);
    } else {
      for (const sub of d.subtitles) {
        if (sub.opacity <= 0) continue;
        const t = new Text({
          text: sub.text,
          style: {
            fontFamily: this.fontFamily,
            fontSize: sub.fontSize,
            fill: sub.color,
            stroke: { color: "#000000", width: sub.outlineWidth * 2 },
            align: sub.align,
          },
        });
        t.anchor.set(sub.align === "center" ? 0.5 : sub.align === "left" ? 0 : 1, 0.5);
        t.position.set(sub.x, sub.y);
        t.alpha = sub.opacity;
        content.addChild(t);
      }
    }

    // ---- 特效 ----
    const overlays = this.overlayRoot;
    overlays.removeChildren();
    for (const fx of d.effects) {
      const p = fx.params;
      switch (fx.type) {
        case "vignette": {
          const strength = typeof p.strength === "number" ? p.strength : 0;
          if (strength <= 0) break;
          const tex = this.getVignetteTexture();
          const sp = new Sprite(tex);
          sp.width = d.width;
          sp.height = d.height;
          sp.alpha = Math.min(1, strength * 1.6);
          overlays.addChild(sp);
          break;
        }
        case "flash": {
          const alpha = typeof p.alpha === "number" ? p.alpha : 0;
          if (alpha <= 0) break;
          overlays.addChild(this.fullScreenRect(d, 0xffffff, alpha));
          break;
        }
        case "transition": {
          const alpha = typeof p.alpha === "number" ? p.alpha : 0;
          const color = typeof p.color === "string" ? hexToNumber(p.color) : 0x000000;
          if (alpha <= 0) break;
          overlays.addChild(this.fullScreenRect(d, color, alpha));
          break;
        }
        case "shake":
          break; // 已并入相机偏移（求值端）
        case "blur": {
          const radius = typeof p.radius === "number" ? p.radius : 0;
          if (radius > fullBlur) fullBlur = radius;
          break;
        }
        case "tint": {
          const amount = typeof p.amount === "number" ? p.amount : 0;
          const color = Array.isArray(p.color) ? (p.color as number[]) : [255, 255, 255];
          if (amount > 0) {
            tintEffects.push({ color: rgbToHex(color), amount });
          }
          break;
        }
      }
    }

    // 全屏模糊（作用于场景内容）
    if (fullBlur > 0) {
      content.filters = [new BlurFilter({ strength: fullBlur, quality: 2 })];
    } else {
      content.filters = [];
    }
    // 全屏色调（乘法混合）
    for (const t of tintEffects) {
      const sp = this.fullScreenRect(d, t.color, t.amount);
      sp.blendMode = "multiply";
      overlays.addChild(sp);
    }
  }

  private buildPresentationDialogue(d: SceneDescriptor, dialogue: PresentationDialogue, content: Container): void {
    if (dialogue.opacity <= 0) return;
    const layout = getDialogueLayout(d.height, dialogue.fontSize);
    const typography = layout.typography;
    const {
      scale,
      nameFontSize: nameSize,
      clubFontSize: clubSize,
      placeFontSize: placeSize,
      nameGap,
      barOffset,
      barWidth,
      barHeight,
    } = typography;
    const x = dialogue.x;
    const nameY = dialogue.nameY;

    // AA-inspired dialogue bed: dim the lower scene without hiding the art.
    const backdrop = new Graphics();
    const bandHeight = Math.max(1, (d.height - layout.backdropTop) / 6);
    for (let i = 0; i < 6; i += 1) {
      const t = i / 5;
      backdrop.rect(0, layout.backdropTop + i * bandHeight, d.width, bandHeight + 1)
        .fill({ color: 0x07111e, alpha: 0.12 + t * 0.58 });
    }
    backdrop.rect(0, layout.dividerY, d.width, Math.max(2, 2 * scale))
      .fill({ color: 0xd9e8f5, alpha: 0.52 * dialogue.opacity });
    backdrop.alpha = dialogue.opacity;
    content.addChild(backdrop);

    const bar = new Graphics();
    bar.rect(x - barOffset, nameY - barHeight / 2, barWidth, barHeight).fill({ color: 0x71d9ff, alpha: dialogue.opacity });
    content.addChild(bar);

    const name = new Text({
      text: dialogue.speaker,
      style: {
        fontFamily: this.fontFamily,
        fontSize: nameSize,
        fontWeight: "700",
        fill: "#ffffff",
        stroke: { color: "#07111e", width: Math.max(2, dialogue.outlineWidth * scale) },
      },
    });
    name.position.set(x, nameY);
    name.anchor.set(0, 0.5);
    name.alpha = dialogue.opacity;
    content.addChild(name);

    if (dialogue.clubName) {
      const club = new Text({
        text: dialogue.clubName,
        style: {
          fontFamily: this.fontFamily,
          fontSize: clubSize,
          fontWeight: "600",
          fill: "#63c9ff",
          stroke: { color: "#07111e", width: Math.max(1, dialogue.outlineWidth * scale * 0.55) },
        },
      });
      club.position.set(x + name.width + nameGap, nameY + 2 * scale);
      club.anchor.set(0, 0.5);
      club.alpha = dialogue.opacity;
      content.addChild(club);
    }

    if (dialogue.placeText) {
      const place = new Text({
        text: dialogue.placeText,
        style: {
          fontFamily: this.fontFamily,
          fontSize: placeSize,
          fontWeight: "600",
          fill: "#b8dcf2",
          stroke: { color: "#07111e", width: Math.max(1, dialogue.outlineWidth * scale * 0.45) },
        },
      });
      place.position.set(x, 74 * scale);
      place.alpha = dialogue.opacity;
      content.addChild(place);
    }

    const visibleText = dialogue.visibleText ?? dialogue.text;
    const body = new Text({
      text: visibleText,
      style: {
        fontFamily: this.fontFamily,
        fontSize: dialogue.fontSize,
        fontWeight: "600",
        fill: "#ffffff",
        stroke: { color: "#000000", width: dialogue.outlineWidth * 2 },
        wordWrap: true,
        wordWrapWidth: d.width - x - 120 * scale,
        lineHeight: layout.bodyLineHeight,
      },
    });
    body.position.set(x, layout.bodyTop);
    body.anchor.set(0, 0);
    body.alpha = dialogue.opacity;
    content.addChild(body);

    if (dialogue.revealComplete === false) return;

    const dialogueLines = visibleText.split(/\r?\n/);
    const lineMetrics = dialogueLines.map((line) => CanvasTextMetrics.measureText(line, body.style, undefined, true));
    const visualLineCount = lineMetrics.reduce((count, metric) => count + Math.max(1, metric.lines.length), 0);
    const lastLine = dialogueLines[dialogueLines.length - 1] ?? visibleText;
    const lastLineMetrics = CanvasTextMetrics.measureText(lastLine, body.style, undefined, true);
    const lastLineWidth = lastLineMetrics.lineWidths[lastLineMetrics.lineWidths.length - 1] ?? body.width;
    const caretCenterY = layout.bodyTop + getDialogueCaretOffset(visualLineCount, layout.bodyLineHeight, dialogue.fontSize);
    const caretHeight = getDialogueCaretHeight(dialogue.fontSize);
    const caret = new Graphics();
    caret.rect(x + lastLineWidth + 20 * scale, caretCenterY - caretHeight / 2, getDialogueCaretWidth(scale), caretHeight).fill({ color: 0x63d9ff, alpha: dialogue.opacity });
    content.addChild(caret);
  }

  private buildLayerSprite(layer: LayerDescriptor): Sprite {
    const url = resolveLayerAssetUrl(layer, this.assetUrls);
    if (!url) return new Sprite(Texture.EMPTY);
    let texture = this.textureCache.get(url);
    if (!texture) {
      return new Sprite(Texture.EMPTY);
    }
    const crop = layer.crop;
    const hasCrop = crop.left > 0 || crop.right > 0 || crop.top > 0 || crop.bottom > 0;
    let tex: Texture = texture;
    if (hasCrop) {
      const bw = texture.baseTexture.width || texture.width || 1;
      const bh = texture.baseTexture.height || texture.height || 1;
      const key = `crop:${layer.assetId}:${crop.left}:${crop.right}:${crop.top}:${crop.bottom}`;
      const cached = this.textureCache.get(key);
      if (cached) {
        tex = cached;
      } else {
        const cropped = new Texture({
          source: texture.source,
          frame: new Rectangle(
            Math.round(bw * crop.left),
            Math.round(bh * crop.top),
            Math.max(1, Math.round(bw * (1 - crop.left - crop.right))),
            Math.max(1, Math.round(bh * (1 - crop.top - crop.bottom))),
          ),
        });
        this.textureCache.set(key, cropped);
        tex = cropped;
      }
    }
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.position.set(layer.x, layer.y);
    sp.scale.set(layer.scaleX * (layer.flipX ? -1 : 1), layer.scaleY);
    sp.rotation = (layer.rotation * Math.PI) / 180;
    sp.alpha = Math.max(0, Math.min(1, layer.opacity));
    sp.tint = rgbToHex(layer.tint);
    if (layer.blur > 0) sp.filters = [new BlurFilter({ strength: layer.blur, quality: 1 })];
    return sp;
  }

  private fullScreenRect(d: SceneDescriptor, color: number, alpha: number): Graphics {
    const g = new Graphics();
    g.rect(0, 0, d.width, d.height).fill({ color, alpha });
    return g;
  }

  private getVignetteTexture(): Texture {
    if (this.vignetteTexture) return this.vignetteTexture;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(256, 256, 80, 256, 256, 362);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.15)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    this.vignetteTexture = Texture.from(canvas);
    return this.vignetteTexture;
  }

  screenToScene(pt: { x: number; y: number }): { x: number; y: number } {
    if (!this.viewport) return pt;
    const s = this.viewport.scale.x;
    if (s === 0) return pt;
    return {
      x: (pt.x - this.viewport.position.x) / s,
      y: (pt.y - this.viewport.position.y) / s,
    };
  }

  sceneToScreen(pt: { x: number; y: number }): { x: number; y: number } {
    if (!this.viewport) return pt;
    return {
      x: pt.x * this.viewport.scale.x + this.viewport.position.x,
      y: pt.y * this.viewport.scale.y + this.viewport.position.y,
    };
  }

  getLayerBounds(layerId: string): { x: number; y: number; w: number; h: number } | null {
    return this.layerBounds.get(layerId) ?? null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
    this.viewport = null;
    this.contentRoot = null;
    this.overlayRoot = null;
  }
}

async function loadImageTexture(url: string): Promise<Texture> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = url;
  });
  return Texture.from(image);
}

function rgbToHex(rgb: number[]): number {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] ?? 255)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] ?? 255)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] ?? 255)));
  return (r << 16) | (g << 8) | b;
}

function hexToNumber(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0x000000;
  return parseInt(m[1], 16);
}
