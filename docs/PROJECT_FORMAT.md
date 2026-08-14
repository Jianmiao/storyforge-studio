# StudioProject 项目格式规范

版本：v1 · 本文档是 **TS 类型（`src/domain/types.ts`）与 Rust serde 模型（`crates/studio-core/src/model.rs`）之间的唯一契约**。两侧任何改动必须同步并跑 roundtrip 测试。

## 1. 文件与目录约定

```
<projectDir>/
├── project.json          # 项目文档（本规范描述的 JSON）
├── project.json.bak1..3  # 轮换备份（每次成功保存后轮换，最多 3 份）
├── assets/               # 素材目录：文件名 = <sha256 前 16 位>.<ext>
└── (运行时) project.json.tmp-<pid>  # 原子写中间文件；进程崩溃后残留会被清理
```

- 扩展名：`.storyforge`（内容为 UTF-8 JSON，无 BOM）。
- 素材引用一律为 `assets/<fileName>`（相对项目目录）；`originalPath` 仅作来源参考，缺失时用于提示。
- **禁止**在应用代码中用字符串拼接构造路径：TS 侧用 `src/domain/paths.ts`，Rust 侧用 `PathBuf`。

## 2. 顶层结构

```jsonc
{
  "formatVersion": 1,
  "meta": { "name": "未命名项目", "createdAt": "2026-08-14T12:00:00Z", "updatedAt": "..." },
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "assets": [ /* AssetRecord[] */ ],
  "scenes": [ /* Scene[] */ ],
  "export": { /* ExportConfig */ }
}
```

## 3. 类型定义

### 3.1 AssetRecord

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 如 `ast_1a2b3c` |
| `kind` | `"image" \| "audio"` | |
| `fileName` | string | `assets/<hash>.<ext>` 中的文件名部分 |
| `originalPath` | string | 导入时原始路径（仅参考） |
| `hash` | string | 内容 SHA-256 hex |
| `width` / `height` | number? | 图像素材 |
| `durationMs` | number? | 音频素材 |
| `missing` | boolean | 打开时由后端校验；不持久化参与编辑 |

### 3.2 Track / Clip

轨道种类：`background | character | camera | subtitle | bgm | voice | sfx | effect`。

```jsonc
{
  "id": "trk_1",
  "kind": "character",
  "name": "角色",
  "muted": false,
  "clips": [ /* Clip[] */ ]
}
```

#### 视觉片段（background / character 轨道；effect 轨道使用 effect 片段）

```jsonc
{
  "id": "clp_1",
  "type": "image",
  "name": "立绘",
  "assetId": "ast_2",
  "start": 60, "duration": 300,          // 帧区间 [start, start+duration)
  "props": {
    "x": 960, "y": 540,                  // 中心点，画布坐标系（原点左上）
    "scaleX": 1.0, "scaleY": 1.0,
    "rotation": 0,                        // 度
    "opacity": 1.0,                       // 0..1
    "tint": [255, 255, 255],              // RGB 颜色乘法
    "blur": 0,                            // 模糊半径（px，预览近似）
    "crop": { "left": 0, "right": 0, "top": 0, "bottom": 0 },  // 0..1 比例
    "flipX": false
  },
  "keyframes": [
    { "frame": 0, "path": "x", "value": 300,  "easing": { "type": "easeInOut" } },
    { "frame": 120, "path": "x", "value": 960, "easing": { "type": "cubic", "c1": [0.42,0], "c2": [0.58,1] } }
  ],
  "actions": {
    "enter": { "type": "none" },          // none | fadeIn | slideInLeft | slideInRight | zoomIn
    "idle": { "type": "none" },           // none | sway | shake | jump | pulse | flashWhite
    "exit": { "type": "none" }            // none | fadeOut | slideOutLeft | slideOutRight | zoomOut
  }
}
```

- 关键帧路径：`x y scaleX scaleY rotation opacity tint.r tint.g tint.b blur crop.left crop.right crop.top crop.bottom flipX assetId`（`assetId` 为离散关键帧：无插值，用于表情切换）。
- 未出现在关键帧中的属性用 `props` 静态值；属性在 `[start, start+duration)` 之外不参与求值。
- `assetId` 离散关键帧：帧号到达即切换贴图，保持到下一个 `assetId` 关键帧。

#### 字幕片段

```jsonc
{
  "id": "clp_3", "type": "subtitle",
  "start": 60, "duration": 120,
  "text": "你好，世界。",
  "x": 960, "y": 940, "fontSize": 64, "color": "#ffffff",
  "align": "center",                     // left | center | right
  "outlineWidth": 4, "opacity": 1.0,
  "keyframes": [ /* 同视觉片段，路径限于 x y opacity fontSize */ ]
}
```

#### 音频片段（bgm / voice / sfx）

```jsonc
{
  "id": "clp_4", "type": "audio",
  "assetId": "ast_9",
  "start": 0, "duration": 360,
  "volume": 0.8, "fadeInFrames": 15, "fadeOutFrames": 30,
  "keyframes": [ /* 路径限于 volume */ ]
}
```

- 采样时间轴：片段内局部时间 `t = (frame - start) / fps`；音频素材按自身采样率解码后重采样至 48k stereo 混音。

#### 特效片段（effect 轨道）

```jsonc
{
  "id": "clp_5", "type": "effect",
  "start": 0, "duration": 360,
  "effect": { "type": "vignette", "params": { "strength": 0.55, "softness": 0.6 } },
  "keyframes": [ /* 路径如 strength softness alpha amount dx dy */ ]
}
```

支持特效：`vignette`（strength, softness）、`flash`（alpha）、`shake`（amplitude, frequency，帧号做种的确定性伪随机偏移）、`tint`（color[3], amount）、`blur`（radius）、`transition`（color, alpha —— 全屏遮罩，用于淡入淡出转场）。

#### 镜头（camera）片段

```jsonc
{
  "id": "clp_6", "type": "camera",
  "start": 0, "duration": 360,
  "props": { "x": 0, "y": 0, "zoom": 1.0 },
  "keyframes": [ /* 路径限于 x y zoom */ ]
}
```

相机变换在图层变换之后应用（先对象变换，再整体平移缩放）。默认相机 `(0,0,1)` 无变换。

## 4. 求值语义（Rust `timeline`，与预览/导出共享）

1. 帧 `N`（0-based）∈ `[0, durationFrames)`；`t = N / fps`。
2. 轨道顺序（合成顺序，后画在上）：`background → character → effect → subtitle → camera（仅变换）`。
3. 片段在 `N ∈ [start, start+duration)` 内活动；字幕/特效/音频同理。
4. 属性求值：属性有 ≥2 个关键帧覆盖该帧 → 相邻关键帧插值（`u = (N-k0)/(k1-k0)`，缓动取**后一个**关键帧的 easing；easing 函数把 `u` 映射到 `e`，`value = lerp(v0,v1,e)`）；仅 1 个关键帧 → 常量；无关键帧 → `props` 静态值。
5. 动作：`enter` 在片段前 15 帧内生效（fadeIn: opacity 0→1；slideInLeft: x 从 -width/2 外进入；zoomIn: scale 0.6→1）；`exit` 在最后 15 帧内生效（对称）；`idle` 全程生效（sway: `x += sin(2π·lf/period)·amp`，period=60, amp=5；shake: 帧号伪随机 ±3px；jump: `y -= sin(π·u)·40`，u=lf/30 内一个周期；pulse: scale *= 1+0.08·sin(2π·lf/30)；flashWhite: 叠加白色蒙版 alpha 随 sin 脉冲）。
6. 特效在全场景合成后按列表顺序应用（shake 平移整体画面，其余为覆盖层）。
7. 音频：活动音频片段 → `volume(N)`（关键帧插值 × fadeIn/fadeOut 线性包络）。

## 5. 版本与迁移

- `formatVersion` 从 `1` 起。升级时：新增 `migrations[from] → to` 的纯函数（输入旧文档 JSON，输出新文档 JSON，**不得改动格式版本之外的其他字段**），并保留 `migrate.rs` / `migrate.ts` 两侧同名实现 + 各自测试。
- 加载流程：读 JSON → 若 `formatVersion` < 当前，按链逐级迁移 → 校验 → 进入编辑器。
- 打开**未知更高版本**：拒绝打开并提示「文件由更新版本创建」。
- 写入流程：始终写当前 `FORMAT_VERSION`。

## 6. 持久化语义（原子写 / 备份 / 恢复）

1. 写 `<path>.tmp-<pid>` → `flush` → `rename` 到 `<path>`（同卷原子替换）。
2. 保存成功后轮换备份：`<path>` → `.bak1`（旧 `.bak1`→`.bak2`→`.bak3`，丢弃最旧）。
3. 打开时：主文件解析失败 → 依次尝试 `.bak1..3`，返回 `{ project, recoveredFrom: "bak1" }`；残留 `.tmp-*` 自动清理（视为上次写入中断，主文件才是权威）。
4. 自动保存：前端在命令提交后 debounce 1.5s 触发；应用启动时若存在上次会话的恢复标记（`.recovery` 目录方案，本阶段未启用，见已知限制），提示恢复。

## 7. 示例（演示项目节选）

```jsonc
{
  "formatVersion": 1,
  "meta": { "name": "演示项目", "createdAt": "2026-08-14T00:00:00Z", "updatedAt": "2026-08-14T00:00:00Z" },
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "assets": [
    { "id": "ast_bg", "kind": "image", "fileName": "a1b2c3d4e5f6a7b8.png", "originalPath": "", "hash": "a1b2...", "width": 1920, "height": 1080 },
    { "id": "ast_char", "kind": "image", "fileName": "9f8e7d6c5b4a3210.png", "originalPath": "", "hash": "9f8e...", "width": 720, "height": 1080 },
    { "id": "ast_bgm", "kind": "audio", "fileName": "0f0f0f0f0f0f0f0f.wav", "originalPath": "", "hash": "0f0f...", "durationMs": 12000 }
  ],
  "scenes": [{
    "id": "scn_demo", "name": "演示场景", "durationFrames": 360,
    "tracks": [
      { "id": "trk_bg", "kind": "background", "name": "背景", "muted": false, "clips": [
        { "id": "clp_bg", "type": "image", "assetId": "ast_bg", "start": 0, "duration": 360, "props": { "x": 960, "y": 540, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1, "tint": [255,255,255], "blur": 0, "crop": { "left": 0, "right": 0, "top": 0, "bottom": 0 }, "flipX": false }, "keyframes": [], "actions": { "enter": { "type": "fadeIn" }, "idle": { "type": "none" }, "exit": { "type": "none" } } }
      ] },
      { "id": "trk_cam", "kind": "camera", "name": "镜头", "muted": false, "clips": [
        { "id": "clp_cam", "type": "camera", "start": 0, "duration": 360, "props": { "x": 0, "y": 0, "zoom": 1 }, "keyframes": [ { "frame": 0, "path": "x", "value": 0, "easing": { "type": "linear" } }, { "frame": 360, "path": "x", "value": 80, "easing": { "type": "linear" } } ] }
      ] },
      { "id": "trk_sub", "kind": "subtitle", "name": "字幕", "muted": false, "clips": [
        { "id": "clp_sub1", "type": "subtitle", "start": 60, "duration": 120, "text": "第一段台词", "x": 960, "y": 940, "fontSize": 64, "color": "#ffffff", "align": "center", "outlineWidth": 4, "opacity": 1, "keyframes": [] },
        { "id": "clp_sub2", "type": "subtitle", "start": 180, "duration": 120, "text": "第二段台词", "x": 960, "y": 940, "fontSize": 64, "color": "#ffffff", "align": "center", "outlineWidth": 4, "opacity": 1, "keyframes": [] }
      ] },
      { "id": "trk_bgm", "kind": "bgm", "name": "BGM", "muted": false, "clips": [
        { "id": "clp_bgm", "type": "audio", "assetId": "ast_bgm", "start": 0, "duration": 360, "volume": 0.7, "fadeInFrames": 30, "fadeOutFrames": 60, "keyframes": [] }
      ] }
    ]
  }],
  "export": { "width": 1920, "height": 1080, "fps": 30, "videoCodec": "h264", "crf": 18, "preset": "veryfast", "audioBitrateKbps": 192 }
}
```

## 8. 扩展性预留

- 素材 `kind` 可扩展 `video`（解码帧序列）；`Clip.type` 可扩展 `video` / `skeleton`。
- `RendererAdapter` 注册表为 Skeleton/Spine/Live2D/3D 预留（见 ARCHITECTURE.md §2.4）；格式中不预埋任何未授权渲染器的私有数据。
- 用户自定义导入器接口（未来）：`ImportAdapter { canHandle(path): boolean; import(path): AssetRecord[] }` 注册表；本阶段不实现任何私有格式的自动提取。
