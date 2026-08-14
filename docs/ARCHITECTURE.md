# StoryForge Studio 架构

版本：2.0（v2 节点式剧情编辑） · 配套：`PROJECT_FORMAT.md`、`MVP_CHECKLIST.md`

> 设计范式借鉴经典剧情节点图（Entry → Script → Selection → Exit），为独立实现；
> 不复制、不移植任何第三方源码或私有格式。项目格式见 PROJECT_FORMAT.md（v2）。

## 0. 编辑范式（v2 核心）

**节点式剧情编辑**：剧本 = 节点图（`script.nodes`），节点类型：
- `entry`：剧本入口（标题/副标题）
- `script`：剧本节点 = 有序**演出行**列表（每行：台词、说话人、在场角色[槽位+动作]、背景、BGM、语音、音效、转场、时长）
- `selection`：选择分支（选项文本列表，第 i 个选项 → 第 i 条连接）
- `exit`：结局

演出 = 沿图执行：Entry → Script（顺序播放行内演出指令）→ Selection（播放器暂停弹出选项，用户选择后沿对应连接继续；离线导出用默认路径 = 每处取第一个选项）→ … → Exit。

- 节点图是**权威剧本**；时间轴降级为「演出序列检查视图」（线性化结果，只读）。
- 求值：`graph.rs` 线性化路径 → 行序列 → 按帧求值 → 同一 `SceneDescriptor` 供预览与离线渲染。
- v1 时间轴项目迁移后保留 `scenes`，求值自动回退时间轴（兼容模式）。

## 1. 总览

StoryForge Studio 是一个 **前端（React）— 状态层 — 后端适配器 — Rust 核心（studio-core）** 的分层桌面应用：

```
┌────────────────────────────── WebView（React 19 + TS）──────────────────────────────┐
│  UI 组件（TopBar / 资源库 / 画布 / 属性 / 时间轴 / 导出）                              │
│        │                                                                             │
│  Zustand store（ProjectDocument + History[命令栈] + UI 态）    （可序列化、可撤销）      │
│        │  BackendAdapter 接口                                                         │
│  ┌─────┴───────────┐        ┌──────────────────────┐                                 │
│  │ tauriAdapter    │        │ mockAdapter          │  ← 浏览器开发 / UI 测试          │
│  │ (invoke/事件)   │        │ (内存 + localStorage)│                                 │
│  └─────┬───────────┘        └──────────────────────┘                                 │
└────────┼────────────────────────────────────────────────────────────────────────────┘
         │ Tauri IPC (JSON 命令 + 事件)
┌────────┴──────────────────────────── Rust (studio-core) ───────────────────────────┐
│  project_io    项目持久化：原子写 / 轮换备份 / 崩溃恢复 / 迁移                         │
│  assets        素材导入 / 哈希去重 / 索引 / 缺失检测 / 重新定位                         │
│  timeline      ★ 时间轴求值器（唯一）：帧 → SceneDescriptor                          │
│  compositor    软件合成器（离线帧栅格化）                                             │
│  audio         解码 / 混音 / 包络（离线）                                             │
│  encoder       FFmpeg 进程管理（管道喂帧 + PCM，进度 / 取消 / 清理）                   │
│  jobs          渲染任务与队列                                                            │
└────────────────────────────────────────────────────────────────────────────────────┘
         │ spawn + pipe
   ┌─────┴─────┐
   │  FFmpeg   │  （系统检测，不随应用分发）
   └───────────┘
```

**核心不变式：所有预览与离线渲染使用同一套时间轴求值逻辑。** 求值器只存在于 Rust（`studio-core`）：
- v2 剧本图：`graph::evaluate(project, path, frame)`（线性化 + 按帧求值）；
- v1 回退：`timeline::evaluate(project, scene, frame)`。

预览与离线渲染都从「帧号 → SceneDescriptor」开始：

- 离线：`evaluate(frame) → composite(frame, descriptor) → RGBA → FFmpeg stdin`（全程 Rust）。
- 预览：IPC `preview.frame(project, path, frame)` 返回同一 `SceneDescriptor`，WebView 内 PixiJS 仅负责**绘制**（不参与求值）。

浏览器开发模式（无 Rust）下，界面依赖 `dev/BrowserFallbackEvaluator.ts` —— 一个**仅存在于 DEV 构建**的测试替身（求值逻辑子集）。它不参与产品路径：产品构建（Tauri）中预览永远走 Rust。UI 自动化测试不对该替身的数值正确性做断言（数值正确性由 `cargo test` 与离线导出验证覆盖）。

## 2. 模块划分与职责

### 2.1 Project Core（`src/domain`，纯 TS，零框架依赖）

- `types.ts`：`StudioProject` 领域模型（与 Rust 侧 serde 模型一一对应，schema 见 PROJECT_FORMAT.md）。
- `schema.ts`：`FORMAT_VERSION = 1`、JSON 校验（保守校验：字段存在性 + 数值合法性）。
- `migrate.ts`：`migrations: Record<number, Migrator>` 注册表；`migrateProject(raw, fromVersion)` 链式升级；未知版本报错。
- `commands.ts`：`Command` 接口（`name / apply / undo`，基于 Immer draft），具体命令类（AddClip / MoveClip / SetClipProps / AddKeyframe / …）。
- `history.ts`：`History`（undo / redo 栈，上限 100，连续同类属性命令可合并）。
- `paths.ts`：**结构化路径 API**。禁止字符串拼接路径；`projectPath = Paths.join(dir, "project.json")` 等，全部经统一 helper，便于替换与测试。
- `serialize.ts`：doc ↔ JSON（严格 JSON、UTF-8、无 BOM）。
- `easing.ts`：缓动求值（linear / easeIn / easeOut / easeInOut / cubic-bezier 二分求解）。
- `demo.ts`：演示项目文档生成（不生成素材文件；素材由后端 `demo.create` 生成）。

设计原则：领域层**不知道** React / Tauri / PixiJS 存在；所有业务状态都在 store 的 `document` 字段（纯 JSON 可序列化），不允许藏在组件或 Pixi 对象里。

### 2.2 状态层（`src/state`）

- `store.ts`：Zustand。`document`（当前项目）、`history`、`ui`（选中项、playhead、缩放、激活场景、对话框状态）。
- 唯一修改 `document` 的通道是 `store.executeCommand(cmd)`；自动保存监听：任何命令提交后 debounce 1.5s 触发 `backend.saveProject`。

### 2.3 BackendAdapter（`src/backend`）

`BackendAdapter` 接口（详见 `adapter.ts`）：

```ts
interface BackendAdapter {
  detectFfmpeg(): Promise<FfmpegInfo>;
  createDemoProject(dir: string): Promise<OpenResult>;
  saveProject(path: string, doc: StudioProject): Promise<SaveResult>;
  openProject(path: string): Promise<OpenResult>;          // 含恢复信息
  importAssets(projectDir: string, sources: string[]): Promise<AssetRecord[]>;
  relocateAsset(projectDir: string, assetId: string, newPath: string): Promise<AssetRecord>;
  checkAssets(projectDir: string): Promise<AssetStatus[]>;
  previewFrame(project: StudioProject, sceneId: string, frame: number): Promise<SceneDescriptor>;
  startRender(spec: RenderSpec): Promise<string>;          // jobId
  cancelRender(jobId: string): Promise<void>;
  listRenderJobs(): Promise<RenderJobInfo[]>;
  onRenderProgress(cb: (e: RenderProgressEvent) => void): () => void;
  pickFiles(filter: AssetFilter): Promise<string[] | null>;
  pickSavePath(defaultName: string): Promise<string | null>;
}
```

- `tauriAdapter`：`invoke` + `@tauri-apps/api/event`；生产路径。
- `mockAdapter`：内存实现（localStorage 持久化项目 JSON），用于 `npm run dev` 与 Playwright 流程测试；素材文件用浏览器 File/URL，音频时长等元数据为占位。

选择哪个实现：`'__TAURI_INTERNALS__' in window ? tauriAdapter : mockAdapter`（在 `backend/index.ts` 单一决策点）。

### 2.4 预览渲染层（`src/preview`）

`RendererAdapter` 接口：

```ts
interface RendererAdapter {
  init(container: HTMLElement, width: number, height: number): Promise<void>;
  renderFrame(d: SceneDescriptor): void;
  setInteractive(interactive: boolean): void;
  screenToScene(pt: {x:number;y:number}): {x:number;y:number};
  sceneToScreen(pt: {x:number;y:number}): {x:number;y:number};
  dispose(): void;
}
```

- `pixiRenderer.ts`：PixiJS 8 实现。`renderFrame` 按 descriptor 的 layer 顺序绘制：图像精灵（含变换 / 裁剪 / 色调 / 不透明度 / 翻转）、字幕文本（系统字体，`fontdue` 之外的预览端用 CanvasText）、特效（shake 平移相机、flash 白层、vignette 渐变纹理、transition 遮罩、blur 滤镜）。编辑器选中态、拖拽框、对齐参考线属于 **UI 覆盖层**（DOM/独立 Graphics），不属于 RendererAdapter 职责。
- **未来适配器**：`SkeletonAdapter` / `SpineAdapter` / `Live2DAdapter` / `Scene3DAdapter` 预留注册表（`rendererRegistry.ts`）；未授权不实现、不伪装。

### 2.5 studio-core（Rust）

crate 结构（无 Tauri 依赖，可独立测试；`src-tauri` 与 `sf_export` CLI 均依赖它）：

```
crates/studio-core/src/
├── lib.rs
├── model.rs        # serde 领域模型（v2：剧本节点图 + v1 兼容 scenes）
├── graph.rs        # ★ 剧本图求值器：线性化（默认路径/分支）→ 行序列 → 帧 → SceneDescriptor
├── timeline.rs     # v1 时间轴求值器（兼容回退）
├── project_io.rs   # save/open：原子写（tmp+fsync+rename）、备份轮换 bak1..3、损坏恢复、tmp 清理
├── migrate.rs      # 迁移链（v0 → v1 → v2）
├── assets.rs       # 导入（复制 + sha256 + 元数据）、缺失检测、重新定位
├── ffmpeg.rs       # 检测（env / PATH / 常见目录）、版本解析
├── compositor.rs   # 软件合成：图像解码缓存、仿射采样（双线性）、合成、模糊、暗角、闪白、震动、文字（fontdue）
├── audio.rs        # symphonia 解码 → 48k stereo f32 缓存；混音 + 包络 → s16le PCM 文件
├── encoder.rs      # FFmpeg 进程：rawvideo stdin + PCM 文件双输入；进度回调；取消 kill；临时文件清理
├── jobs.rs         # RenderJob 状态机 + 顺序队列
└── demo.rs         # 演示项目生成（v2 节点式剧本 + 全本地合成素材）
```

**求值器契约**：输入 `(&Project, path, frame)` → 输出 `SceneDescriptor`（帧号、相机、图层列表、字幕列表、特效列表、音频列表）。纯函数、无 I/O、确定性（震动等伪随机用帧号做种）。

### 2.6 Tauri 壳（`src-tauri`）

- 命令：`project.*`、`asset.*`、`ffmpeg.*`、`preview.frame`、`render.start|cancel|list`、`demo.create`、`dialog`（经 tauri-plugin-dialog）。
- 事件：`render-progress`（`{jobId, frame, total, etaSec, fps}`）、`render-finished`。
- 资源协议：`assetProtocol` 启用（scope `**`），前端用 `convertFileSrc` 加载项目内素材。

## 3. 关键设计决策（ADR）

| # | 决策 | 理由 | 代价 / 缓解 |
| --- | --- | --- | --- |
| D1 | 时间轴求值逻辑**只存在于 Rust** | 满足「预览与离线渲染同一套求值」硬性要求；离线渲染必须在 Rust 进程内驱动 FFmpeg | 预览每帧一次 IPC；帧描述 ≤ 数 KB，往返 <5ms，可承受；慢时「追赶跳帧」 |
| D2 | 浏览器 dev 模式用 `BrowserFallbackEvaluator`（DEV-only stub） | Playwright / 无 Rust 环境下也能做 UI 流程测试 | 该路径不参与产品；数值正确性由 cargo test + 导出验证负责；文件头显著标注 |
| D3 | 音频导出 = 先混音成临时 PCM 文件 + 视频帧走 stdin | Windows 下双命名管道复杂度高、易踩坑 | 增加一次 PCM 临时写读（12s≈4.6MB，可忽略）；取消时一并清理 |
| D4 | 离线渲染 = 软件合成器（自研仿射采样合成） | 不依赖 GPU / 屏幕状态，保证可复现、可测试、可后台 | 性能靠 rayon 行并行；1080p 单帧约几十 ms 级；模糊算法与 Pixi 有差异（记录在案） |
| D5 | 状态权威在前端（Zustand），持久化权威在 Rust | 编辑交互低延迟；命令模式在 TS 侧可测；Rust 只做 IO / 求值 / 渲染 | 需要 TS↔Rust 模型双份定义（以 PROJECT_FORMAT.md 为单一契约，roundtrip 测试兜底） |
| D6 | 素材以内容哈希命名存放于项目 `assets/` 目录 | 去重、可迁移、缺素材可重定位 | 需要把原始路径记录为元数据（仅参考） |
| D7 | 项目路径一律走结构化 API（TS `paths.ts` / Rust `PathBuf`） | 避免字符串拼接路径的跨平台坑 | — |
| D8 | 长任务（导入 / 渲染）全部可取消、可报告进度 | 验收硬性要求 | 渲染：cancel flag + kill + 清理；导入：逐文件取消点 |
| D9 | 未实现能力（Spine/Live2D/3D/多场景转场）在 UI 上明确显示「未支持」 | 不许伪装 | — |

## 4. 离线渲染管线（细节）

```
用户点击导出
  → 前端构造 RenderSpec（项目 JSON 快照 + 分辨率/FPS/码率/输出路径）
  → invoke render.start → jobs.rs 入队
  → worker 线程：
      1. 解析项目，加载并缓存全部图像（RGBA）与音频（48k stereo f32）
      2. audio.rs 混音 → <out>.pcm.tmp（取消清理点 1）
      3. spawn ffmpeg：rawvideo(rgb24,WxH,fps) stdin + s16le PCM 文件 → H.264/AAC MP4 → <out>.part.tmp
      4. for frame in 0..N：timeline.evaluate → compositor.composite → stdin.write；
         每 5 帧 emit render-progress（frame/total/ETA）
      5. 关 stdin → 等 ffmpeg 退出 → 校验 exit code → rename <out>.part.tmp → <out>
  → 任一环节取消：cancel flag 置位 → kill ffmpeg → 删除全部 *.tmp 与半成品 → 状态 Cancelled
  → 失败：捕获 ffmpeg stderr 尾段作为失败原因
```

- 帧数与时长严格一致：`N = ceil(durationFrames)`，音频按 `N/fps` 秒精确裁剪填充，输出 `nb_frames == N`，音画时长差 < 0.1s（验收断言）。
- 渲染线程不触碰 GUI 主线程（Tauri 命令在独立线程执行），窗口最小化 / 失焦不影响导出。

## 5. 测试策略

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| TS 领域 | vitest (jsdom) | 命令栈 undo/redo 语义、命令合并、迁移 v0→v1、序列化 roundtrip、路径 API、演示项目结构 |
| Rust 核心 | cargo test | 求值器（区间、关键帧插值、缓动、相机、动作、字幕、音频包络）、原子写 / 备份轮换 / 损坏恢复、迁移、混音包络、合成器冒烟 |
| UI 流程 | Playwright | 新建→导入→加轨道/片段→选择→属性编辑→撤销/重做→保存→播放→导出对话框；快捷键 |
| 导出验收 | ffprobe 脚本 | 真实 MP4：流属性、帧数、时长、音画同步、可播放 |

Playwright 默认跑 vite+mock；真实 Tauri 端到端（WebView2 CDP）为增强路径，见 `e2e/README`。

## 6. 未来演进（非本阶段实现）

- 多场景串联播放与场景间转场；视频片段轨道与逐帧素材；LUT 调色；时间重映射。
- 骨架渲染（Spine/Skeleton）作为 `RendererAdapter` 的可替换实现，接入前提：明确授权。
- 渲染集群化（导出队列跨机器）；GPU 合成（wgpu）作为软件合成器的可替换后端（保持 SceneDescriptor 契约不变）。
