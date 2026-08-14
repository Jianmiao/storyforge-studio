//! 软件合成器：SceneDescriptor → RGB24 帧。
//! 与预览端 PixiJS 共享同一求值契约（SceneDescriptor），合成语义一致（模糊算法为近似，见文档）。
//! 性能：行级 rayon 并行 + 图像/字形缓存；确定性输出（无 GPU / 屏幕依赖）。

use crate::model::Project;
use crate::timeline::SceneDescriptor;
use image::RgbaImage;
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::Path;

pub struct Compositor {
    width: u32,
    height: u32,
    images: HashMap<String, RgbaImage>,
    font: Option<fontdue::Font>,
    glyph_cache: HashMap<(char, u32), (fontdue::Metrics, Vec<u8>)>,
    vignette_alpha: Option<Vec<f32>>, // 预生成暗角 alpha（0..1，尺寸同帧）
}

#[derive(Debug, thiserror::Error)]
pub enum CompositorError {
    #[error("字体加载失败，字幕将不渲染")]
    FontUnavailable,
    #[error("缺少图像素材: {0}")]
    MissingImage(String),
}

impl Compositor {
    pub fn new(width: u32, height: u32, images: HashMap<String, RgbaImage>) -> Self {
        let font = load_system_font();
        Compositor {
            width,
            height,
            images,
            font,
            glyph_cache: HashMap::new(),
            vignette_alpha: None,
        }
    }

    /// 合成一帧。out 长度必须为 width*height*3（RGB24）。
    pub fn composite(&mut self, desc: &SceneDescriptor, out: &mut [u8]) -> Result<(), CompositorError> {
        debug_assert_eq!(out.len(), (self.width * self.height * 3) as usize);
        out.fill(0);

        let w = self.width as usize;
        let h = self.height as usize;
        let center_x = self.width as f64 / 2.0;
        let center_y = self.height as f64 / 2.0;
        let zoom = desc.camera.zoom;
        let cam_bx = desc.camera.x + (1.0 - zoom) * center_x;
        let cam_by = desc.camera.y + (1.0 - zoom) * center_y;

        // 先收集模糊强度（全屏 blur 特效）
        let mut full_blur = 0.0_f64;
        for fx in &desc.effects {
            if fx.effect_type == crate::model::EffectType::Blur {
                if let Some(r) = fx.params.get("radius").and_then(|v| v.as_f64()) {
                    if r > full_blur {
                        full_blur = r;
                    }
                }
            }
        }

        // ---- 图层（按顺序，后画在上） ----
        for layer in &desc.layers {
            self.draw_layer(layer, out, zoom, cam_bx, cam_by);
        }

        // ---- 字幕 ----
        for sub in &desc.subtitles {
            if sub.opacity > 0.0 {
                self.draw_subtitle(sub, out);
            }
        }

        // ---- 特效（按数组序；vignette 最后作为屏幕效果） ----
        let mut tint: Option<([u8; 3], f64)> = None;
        for fx in &desc.effects {
            match fx.effect_type {
                crate::model::EffectType::Blur => {} // 已收集，最后应用
                crate::model::EffectType::Tint => {
                    if let (Some(c), Some(a)) = (
                        fx.params.get("color").and_then(|v| v.as_array()).and_then(|arr| {
                            Some([
                                arr.first().and_then(|x| x.as_u64()).unwrap_or(255) as u8,
                                arr.get(1).and_then(|x| x.as_u64()).unwrap_or(255) as u8,
                                arr.get(2).and_then(|x| x.as_u64()).unwrap_or(255) as u8,
                            ])
                        }),
                        fx.params.get("amount").and_then(|v| v.as_f64()),
                    ) {
                        tint = Some((c, a.clamp(0.0, 1.0)));
                    }
                }
                crate::model::EffectType::Flash => {
                    if let Some(a) = fx.params.get("alpha").and_then(|v| v.as_f64()) {
                        if a > 0.0 {
                            blend_solid(out, 255, 255, 255, a.clamp(0.0, 1.0));
                        }
                    }
                }
                crate::model::EffectType::Transition => {
                    let alpha = fx.params.get("alpha").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if alpha > 0.0 {
                        let color = fx
                            .params
                            .get("color")
                            .and_then(|v| v.as_str())
                            .and_then(parse_hex_color)
                            .unwrap_or([0, 0, 0]);
                        blend_solid(out, color[0], color[1], color[2], alpha.clamp(0.0, 1.0));
                    }
                }
                crate::model::EffectType::Vignette => {
                    let strength = fx.params.get("strength").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if strength > 0.0 {
                        let softness = fx.params.get("softness").and_then(|v| v.as_f64()).unwrap_or(0.6);
                        self.apply_vignette(out, strength.clamp(0.0, 1.0), softness.clamp(0.0, 1.0));
                    }
                }
                crate::model::EffectType::Shake => {} // 已并入相机
            }
        }

        // ---- 色调（乘法） ----
        if let Some((color, amount)) = tint {
            if amount > 0.0 {
                multiply_color(out, color, amount);
            }
        }

        // ---- 全屏模糊（最后，作用于内容） ----
        if full_blur > 0.0 {
            box_blur(out, w, h, full_blur.max(1.0) as usize);
        }

        Ok(())
    }

    /// 绘制单个图像图层（含相机变换、裁剪、翻转、色调、白闪）。
    fn draw_layer(&mut self, layer: &crate::timeline::LayerDesc, out: &mut [u8], zoom: f64, cam_bx: f64, cam_by: f64) {
        let img = match self.images.get(&layer.asset_id) {
            Some(i) => i,
            None => return, // 素材缺失：跳过该层
        };
        if layer.opacity <= 0.0 {
            return;
        }
        let (iw, ih) = (img.width() as f64, img.height() as f64);
        // 裁剪区域（源像素坐标）
        let crop = &layer.crop;
        let cl = (crop.left * iw).floor().max(0.0);
        let cr = (crop.right * iw).floor().max(0.0);
        let ct = (crop.top * ih).floor().max(0.0);
        let cb = (crop.bottom * ih).floor().max(0.0);
        let cw = (iw - cl - cr).max(1.0);
        let ch = (ih - ct - cb).max(1.0);
        // 裁剪区域中心（锚点）
        let anchor_x = cl + cw / 2.0;
        let anchor_y = ct + ch / 2.0;

        let theta = layer.rotation.to_radians();
        let (sin, cos) = theta.sin_cos();
        let sx = layer.scale_x;
        let sy = layer.scale_y;
        // 屏幕 = zoom * (R*S*p_img + t) + (cam + (1-zoom)C)
        // 逆：p_img = S^-1 * R(-θ) * (screen - b) / zoom；b = zoom*t + cam_b
        let bx = zoom * layer.x + cam_bx;
        let by = zoom * layer.y + cam_by;
        let inv_sx = if sx.abs() < 1e-9 { 1.0 } else { 1.0 / sx };
        let inv_sy = if sy.abs() < 1e-9 { 1.0 } else { 1.0 / sy };
        let inv_zoom = if zoom.abs() < 1e-9 { 1.0 } else { 1.0 / zoom };
        let flip = if layer.flip_x { -1.0 } else { 1.0 };

        let w = self.width as usize;
        let opacity = layer.opacity.clamp(0.0, 1.0);
        let flash = layer.flash.clamp(0.0, 1.0);
        let tint = layer.tint;
        let px = img.as_raw();

        // 行并行（每行独立；行内顺序访问缓存友好）
        let row_bytes = w * 3;
        out.par_chunks_mut(row_bytes)
            .enumerate()
            .for_each(|(y, row)| {
                let yy = y as f64 + 0.5;
                for (x, px_out) in row.chunks_exact_mut(3).enumerate() {
                    let xx = x as f64 + 0.5;
                    let dx = xx - bx;
                    let dy = yy - by;
                    // p_img（锚定于裁剪中心）
                    let rx = (dx * cos + dy * sin) * inv_zoom * inv_sx * flip;
                    let ry = (-dx * sin + dy * cos) * inv_zoom * inv_sy;
                    let ux = rx + anchor_x;
                    let uy = ry + anchor_y;
                    if ux < cl || ux >= cl + cw || uy < ct || uy >= ct + ch {
                        continue;
                    }
                    // 双线性采样（裁剪区域边界内）
                    let x0 = ux.floor();
                    let y0 = uy.floor();
                    let fx = ux - x0;
                    let fy = uy - y0;
                    let x1 = (x0 + 1.0).min(cl + cw - 1.0);
                    let y1 = (y0 + 1.0).min(ct + ch - 1.0);
                    let idx = |xi: f64, yi: f64| -> usize { (yi as usize) * iw as usize * 4 + (xi as usize) * 4 };
                    let p00 = idx(x0, y0);
                    let p10 = idx(x1, y0);
                    let p01 = idx(x0, y1);
                    let p11 = idx(x1, y1);
                    let mut r = (px[p00] as f64) * (1.0 - fx) * (1.0 - fy)
                        + (px[p10] as f64) * fx * (1.0 - fy)
                        + (px[p01] as f64) * (1.0 - fx) * fy
                        + (px[p11] as f64) * fx * fy;
                    let mut g = (px[p00 + 1] as f64) * (1.0 - fx) * (1.0 - fy)
                        + (px[p10 + 1] as f64) * fx * (1.0 - fy)
                        + (px[p01 + 1] as f64) * (1.0 - fx) * fy
                        + (px[p11 + 1] as f64) * fx * fy;
                    let mut b = (px[p00 + 2] as f64) * (1.0 - fx) * (1.0 - fy)
                        + (px[p10 + 2] as f64) * fx * (1.0 - fy)
                        + (px[p01 + 2] as f64) * (1.0 - fx) * fy
                        + (px[p11 + 2] as f64) * fx * fy;
                    let a = (px[p00 + 3] as f64) * (1.0 - fx) * (1.0 - fy)
                        + (px[p10 + 3] as f64) * fx * (1.0 - fy)
                        + (px[p01 + 3] as f64) * (1.0 - fx) * fy
                        + (px[p11 + 3] as f64) * fx * fy;
                    let src_a = a / 255.0 * opacity;
                    if src_a <= 0.0 {
                        continue;
                    }
                    // 色调
                    r *= tint[0] as f64 / 255.0;
                    g *= tint[1] as f64 / 255.0;
                    b *= tint[2] as f64 / 255.0;
                    // 白闪
                    if flash > 0.0 {
                        r = r + (255.0 - r) * flash;
                        g = g + (255.0 - g) * flash;
                        b = b + (255.0 - b) * flash;
                    }
                    // src-over 合成
                    let dst_a = 1.0 - src_a;
                    px_out[0] = (r * src_a + px_out[0] as f64 * dst_a).round() as u8;
                    px_out[1] = (g * src_a + px_out[1] as f64 * dst_a).round() as u8;
                    px_out[2] = (b * src_a + px_out[2] as f64 * dst_a).round() as u8;
                }
            });
    }

    fn draw_subtitle(&mut self, sub: &crate::timeline::SubtitleDesc, out: &mut [u8]) {
        let font = match &self.font {
            Some(f) => f.clone(),
            None => return,
        };
        let px = sub.font_size.max(4.0) as f32;
        let w = self.width as usize;
        let h = self.height as usize;
        let line = sub.text.clone();

        // 测量总宽（advance）与上下边界（Metrics.ymin 为位图底边相对基线偏移，向上为正）
        let mut total_advance = 0.0_f32;
        let mut max_ascent = 0.0_f32;
        let mut max_descent = 0.0_f32;
        for ch in line.chars() {
            let (metrics, _) = self.glyph(font.clone(), ch, px);
            total_advance += metrics.advance_width;
            let top = (metrics.ymin + metrics.height as i32) as f32;
            max_ascent = max_ascent.max(top);
            max_descent = max_descent.max((-metrics.ymin).max(0) as f32);
        }
        if total_advance <= 0.0 {
            return;
        }
        let align = sub.align.as_str();
        let block_h = (max_ascent + max_descent) as f64;
        // 文本块左上角（水平按对齐，垂直居中于 sub.y）
        let (origin_x, origin_y) = match align {
            "left" => (sub.x - total_advance as f64, sub.y - block_h / 2.0),
            "right" => (sub.x, sub.y - block_h / 2.0),
            _ => (sub.x - total_advance as f64 / 2.0, sub.y - block_h / 2.0),
        };
        let baseline_y = origin_y + max_ascent as f64;
        let outline = sub.outline_width.max(0.0) as f32;
        let alpha = sub.opacity.clamp(0.0, 1.0);

        let mut cursor_x = origin_x;
        for ch in line.chars() {
            let (metrics, bitmap) = self.glyph(font.clone(), ch, px);
            let gw = metrics.width as i32;
            let gh = metrics.height as i32;
            let gx = (cursor_x + metrics.xmin as f64).round() as i32;
            let gy = (baseline_y - metrics.ymin as f64 - metrics.height as f64).round() as i32;
            if outline > 0.0 {
                let offsets: [(i32, i32); 8] = [
                    (-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1),
                ];
                let ow = outline.ceil() as i32;
                for (ox, oy) in offsets {
                    self.blit_glyph(out, w, h, &bitmap, gw, gh, gx + ox * ow, gy + oy * ow, 0, 0, 0, alpha);
                }
            }
            self.blit_glyph(out, w, h, &bitmap, gw, gh, gx, gy, 255, 255, 255, alpha);
            cursor_x += metrics.advance_width as f64;
        }
    }

    fn glyph(&mut self, font: fontdue::Font, ch: char, px: f32) -> (fontdue::Metrics, Vec<u8>) {
        let key = (ch, px as u32);
        if let Some(entry) = self.glyph_cache.get(&key) {
            return entry.clone();
        }
        let (metrics, bitmap) = font.rasterize(ch, px);
        let entry = (metrics, bitmap);
        self.glyph_cache.insert(key, entry.clone());
        entry
    }

    #[allow(clippy::too_many_arguments)]
    fn blit_glyph(
        &self,
        out: &mut [u8],
        w: usize,
        h: usize,
        bitmap: &[u8],
        gw: i32,
        gh: i32,
        gx: i32,
        gy: i32,
        cr: u8,
        cg: u8,
        cb: u8,
        alpha: f64,
    ) {
        for gyi in 0..gh {
            let oy = gy + gyi;
            if oy < 0 || oy >= h as i32 {
                continue;
            }
            let row_base = (oy as usize) * w * 3;
            for gxi in 0..gw {
                let ox = gx + gxi;
                if ox < 0 || ox >= w as i32 {
                    continue;
                }
                let cov = bitmap[gyi as usize * gw as usize + gxi as usize] as f64 / 255.0;
                if cov <= 0.0 {
                    continue;
                }
                let idx = row_base + ox as usize * 3;
                let a = cov * alpha;
                out[idx] = (cr as f64 * a + out[idx] as f64 * (1.0 - a)).round() as u8;
                out[idx + 1] = (cg as f64 * a + out[idx + 1] as f64 * (1.0 - a)).round() as u8;
                out[idx + 2] = (cb as f64 * a + out[idx + 2] as f64 * (1.0 - a)).round() as u8;
            }
        }
    }

    fn apply_vignette(&mut self, out: &mut [u8], strength: f64, softness: f64) {
        let w = self.width as usize;
        let h = self.height as usize;
        // 预生成 alpha 图（分辨率相关，一次生成）
        if self.vignette_alpha.is_none() {
            let mut alpha = vec![0.0_f32; w * h];
            let cx = w as f32 / 2.0;
            let cy = h as f32 / 2.0;
            let max_r = (cx * cx + cy * cy).sqrt().max(1.0);
            for y in 0..h {
                for x in 0..w {
                    let dx = (x as f32 - cx) / max_r;
                    let dy = (y as f32 - cy) / max_r;
                    let d = (dx * dx + dy * dy).sqrt();
                    // softness 控制暗角起始位置（0=全程，1=边缘）
                    let t = ((d - (1.0 - softness as f32 * 0.9)) / (0.9 + softness as f32 * 0.1)).clamp(0.0, 1.0);
                    alpha[y * w + x] = t * t;
                }
            }
            self.vignette_alpha = Some(alpha);
        }
        let alpha = self.vignette_alpha.as_ref().unwrap();
        let strength_f = strength as f32;
        out.par_chunks_mut(w * 3).enumerate().for_each(|(y, row)| {
            for (x, px) in row.chunks_exact_mut(3).enumerate() {
                let a = alpha[y * w + x] * strength_f;
                if a <= 0.0 {
                    continue;
                }
                px[0] = (px[0] as f32 * (1.0 - a)).round() as u8;
                px[1] = (px[1] as f32 * (1.0 - a)).round() as u8;
                px[2] = (px[2] as f32 * (1.0 - a)).round() as u8;
            }
        });
    }
}

/// 用纯色按 alpha 覆盖整帧。
fn blend_solid(out: &mut [u8], r: u8, g: u8, b: u8, alpha: f64) {
    if alpha <= 0.0 {
        return;
    }
    let a = alpha.clamp(0.0, 1.0);
    for px in out.chunks_exact_mut(3) {
        px[0] = (r as f64 * a + px[0] as f64 * (1.0 - a)).round() as u8;
        px[1] = (g as f64 * a + px[1] as f64 * (1.0 - a)).round() as u8;
        px[2] = (b as f64 * a + px[2] as f64 * (1.0 - a)).round() as u8;
    }
}

/// 全帧颜色乘法。
fn multiply_color(out: &mut [u8], color: [u8; 3], amount: f64) {
    let f = amount.clamp(0.0, 1.0);
    let mr = 1.0 + (color[0] as f64 / 255.0 - 1.0) * f;
    let mg = 1.0 + (color[1] as f64 / 255.0 - 1.0) * f;
    let mb = 1.0 + (color[2] as f64 / 255.0 - 1.0) * f;
    for px in out.chunks_exact_mut(3) {
        px[0] = ((px[0] as f64) * mr).round().clamp(0.0, 255.0) as u8;
        px[1] = ((px[1] as f64) * mg).round().clamp(0.0, 255.0) as u8;
        px[2] = ((px[2] as f64) * mb).round().clamp(0.0, 255.0) as u8;
    }
}

/// 滑窗 box blur（水平 + 垂直），近似高斯。
fn box_blur(buf: &mut [u8], w: usize, h: usize, radius: usize) {
    if radius == 0 || w < 2 || h < 2 {
        return;
    }
    let mut tmp = vec![0_u8; buf.len()];
    let r = radius.min(w.min(h) / 2).max(1);
    // 水平
    for y in 0..h {
        let row = &buf[y * w * 3..(y + 1) * w * 3];
        let trow = &mut tmp[y * w * 3..(y + 1) * w * 3];
        for c in 0..3 {
            let mut sum: i64 = 0;
            for x in 0..(r.min(w)) {
                sum += row[x * 3 + c] as i64;
            }
            for x in 0..w {
                let add = if x + r < w { row[(x + r) * 3 + c] as i64 } else { row[(w - 1) * 3 + c] as i64 };
                let sub = if x > r { row[(x - r - 1) * 3 + c] as i64 } else { 0 };
                sum += add - sub;
                let n = ((x + r).min(w - 1) - x.saturating_sub(r + 1)) as i64 + 1;
                trow[x * 3 + c] = (sum as f64 / n as f64).round() as u8;
            }
        }
    }
    // 垂直
    for x in 0..w {
        for c in 0..3 {
            let mut sum: i64 = 0;
            for y in 0..(r.min(h)) {
                sum += tmp[y * w * 3 + x * 3 + c] as i64;
            }
            for y in 0..h {
                let add = if y + r < h { tmp[(y + r) * w * 3 + x * 3 + c] as i64 } else { tmp[(h - 1) * w * 3 + x * 3 + c] as i64 };
                let sub = if y > r { tmp[(y - r - 1) * w * 3 + x * 3 + c] as i64 } else { 0 };
                sum += add - sub;
                let n = ((y + r).min(h - 1) - y.saturating_sub(r + 1)) as i64 + 1;
                buf[y * w * 3 + x * 3 + c] = (sum as f64 / n as f64).round() as u8;
            }
        }
    }
}

fn parse_hex_color(s: &str) -> Option<[u8; 3]> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(s, 16).ok()?;
    Some([((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8])
}

/// 加载系统字体（优先支持中文的字体；不捆绑任何字体文件）。
fn load_system_font() -> Option<fontdue::Font> {
    let candidates: &[(&str, u32)] = &[
        (r"C:\Windows\Fonts\msyh.ttc", 0),
        (r"C:\Windows\Fonts\msyhbd.ttc", 0),
        (r"C:\Windows\Fonts\simhei.ttf", 0),
        (r"C:\Windows\Fonts\simsun.ttc", 0),
        (r"C:\Windows\Fonts\segoeui.ttf", 0),
        (r"C:\Windows\Fonts\arial.ttf", 0),
    ];
    for (path, idx) in candidates {
        if let Ok(data) = std::fs::read(path) {
            let settings = fontdue::FontSettings {
                collection_index: *idx,
                ..Default::default()
            };
            if let Ok(font) = fontdue::Font::from_bytes(data, settings) {
                return Some(font);
            }
        }
    }
    None
}

/// 预加载图像素材（assetId → RGBA）。project 中引用的所有图像都会被解码。
pub fn load_images(project: &Project, project_dir: &Path) -> HashMap<String, RgbaImage> {
    let mut out = HashMap::new();
    for asset in &project.assets {
        if asset.kind != crate::model::AssetKind::Image {
            continue;
        }
        let path = project_dir.join("assets").join(&asset.file_name);
        if let Ok(img) = image::open(&path) {
            out.insert(asset.id.clone(), img.to_rgba8());
        }
    }
    out
}
