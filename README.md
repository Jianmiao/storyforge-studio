# StoryForge Studio

> 独立的 Windows 优先**节点式剧情编辑** / 视频创作工具。剧本节点图（Entry → Script → Selection → Exit）、演出行指令、分支选择、可靠离线渲染，一站式完成。

StoryForge Studio 是**从零独立实现**的桌面视频创作工具：不包含、不移植、不依赖任何第三方游戏的源码、私有项目格式、素材或视觉资产；所有素材均由用户主动导入本地文件。本项目不读取、不修改、不启动任何现有程序（包括 Azure Archive 及其解包产物）。编辑范式借鉴经典剧情节点图设计（节点式连接），为独立实现。

## 功能总览（第一阶段 MVP，v2 节点式）

- **节点式剧本编辑**：剧本 = 节点图（`entry` 入口 / `script` 剧本节点[演出行] / `selection` 选择分支 / `exit` 结局）；节点画布拖拽布局、端口拖拽连线；右侧面板编辑演出行（台词、说话人、在场角色[槽位+动作]、背景、BGM、语音、音效、转场、时长）。
- **演出行指令**：一行 = 一条完整演出指令；背景/角色状态自动继承；行首转场（fade）、背景特效（blur）。
- **分支播放**：播放到选择节点暂停弹出选项，选择后路径重建继续；离线导出使用当前路径（默认 = 每处第一个选项）。
- **项目**：新建 / 保存 / 打开 `StudioProject v2`（版本化 JSON，迁移链 v0→v1→v2），原子写入 + 轮换备份 + 崩溃恢复，自动保存。
- **编辑**：命令模式 Undo/Redo（不散落在组件内）；v1 时间轴项目迁移后保留并回退求值（兼容模式）。
- **素材**：导入 PNG / JPG / WebP / WAV / MP3 / OGG；内容哈希去重；尺寸 / 时长索引；缺失检测与重新定位。
- **预览**：PixiJS 渲染层，通过 `RendererAdapter` 接口与编辑器解耦；预览与离线渲染共用**同一套 Rust 求值逻辑**（`graph.rs` 剧本图求值 + `timeline.rs` 回退）。
- **离线导出**：固定帧步进、FFmpeg 管道编码（MP4 / H.264 + AAC），可选分辨率 / FPS / 码率；后台任务：进度、ETA、取消、失败原因、临时文件清理、渲染队列批量导出；不受窗口最小化或显示器刷新率影响。
- **UI**：工作台首屏（无落地页）；节点图主视图 + 预览浮窗 + 演出序列检查视图（只读）；所有图标按钮带 tooltip；快捷键；深色主题。
- **演示项目**：一键生成**含选择分支**的自包含演示剧本（本地合成素材），用作离线渲染验收样例（默认路径 360 帧 = 12s @ 1080p30）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript + Vite |
| 状态 | Zustand + Immer（可序列化、可撤销、可测试） |
| 图标 | lucide-react |
| 预览渲染 | PixiJS 8（经 `RendererAdapter` 接口隔离） |
| 后端 | Rust：文件系统、项目持久化、素材索引、时间轴求值、软件合成、音频混音、FFmpeg 进程管理 |
| 编码 | 本地 FFmpeg（应用启动检测，UI 明确显示缺失状态） |

## 开发环境

- Windows 10/11（第一目标平台；架构保持跨平台可移植）
- Node.js ≥ 20（开发机为 v24）
- Rust stable（`rustup` 安装，MSVC toolchain）
- FFmpeg 6+/7+（任意 `ffmpeg.exe` 在 PATH 或常见安装目录；也可通过 `STORYFORGE_FFMPEG` 环境变量或导出对话框内手动指定）
- WebView2 Runtime（Windows 10/11 通常自带）
- 网络：npm registry 与 crates.io 可达（如在中国大陆，可配置 npm/cargo 镜像）

## 运行方式

```bash
# 0) 安装前端依赖
npm install

# 1) 纯浏览器开发模式（UI 迭代；时间轴求值走 DEV 专用 stub，仅用于 UI 测试）
npm run dev            # http://localhost:1420

# 2) 完整桌面应用（真实 Rust 后端 + 真实求值 + 真实导出）
npm run tauri dev

# 3) 打包（可选）
npm run tauri build
```

> 说明：`npm run dev` 的浏览器模式仅用于界面开发与 UI 测试，其中的时间轴求值是 `BrowserFallbackEvaluator`（仅 `import.meta.env.DEV` 存在，明确标注为测试替身）。**产品中预览与离线渲染始终使用 Rust 求值逻辑**，二者输出同一 `SceneDescriptor`。

## 测试与验证

```bash
npm test                 # vitest：命令栈 / 迁移 / 序列化 / 路径 API / 演示项目生成
cargo test -p studio-core   # Rust：时间轴求值 / 原子写与备份轮换 / 崩溃恢复 / 混音 / 合成器
npm run e2e              # Playwright：关键 UI 流程（默认跑 vite+mock 后端；真实后端见 docs）
```

### 离线导出验收（无 GUI 也可验证）

```bash
# 生成演示项目并渲染为 1080p30 MP4（12 秒、360 帧、字幕 + 音频），随后自动 ffprobe 校验
npm run verify-export
# 等价 CLI：
cargo run --manifest-path src-tauri/Cargo.toml --bin sf_export -- --demo --out D:/tmp/storyforge-demo.mp4
```

校验内容：文件存在、视频流 1920×1080@30、`nb_frames == 360`、时长 ≈ 12.0s、音频流存在（AAC）、音画时长偏差 < 0.1s。

## 目录结构

```
StoryForge/
├── docs/                    # ARCHITECTURE.md / PROJECT_FORMAT.md / MVP_CHECKLIST.md
├── src/                     # 前端（React + TS）
│   ├── domain/              # Project Core：类型、迁移、命令、路径 API（纯 TS，无框架依赖）
│   ├── state/               # Zustand store + History
│   ├── backend/             # BackendAdapter 接口 + tauri / mock 实现
│   ├── preview/             # RendererAdapter 接口 + PixiJS 实现
│   ├── dev/                 # BrowserFallbackEvaluator（DEV 测试替身，非产品路径）
│   └── components/          # 编辑器 UI
├── e2e/                     # Playwright 测试与夹具
├── scripts/                 # 夹具生成、导出校验脚本
└── src-tauri/
    ├── src/                 # Tauri 壳（命令注册、事件）
    ├── src/bin/sf_export.rs # 无 GUI 导出 CLI（验证用）
    └── crates/studio-core/  # 核心 Rust 库：io / assets / timeline / compositor / audio / encoder / jobs
```

## 已知限制（第一阶段）

- 软件合成器（离线）与 PixiJS 预览在**模糊滤镜**上的实现算法不同（box blur vs 高斯近似），其余属性语义一致；文档见 ARCHITECTURE.md。
- 音频导出采用「先混音为临时 PCM 文件 + 视频帧走 stdin 管道」的双输入 FFmpeg 方案（避免 Windows 下双命名管道复杂度）。
- 文本渲染使用系统字体（优先微软雅黑等支持中文的字体），不捆绑任何字体文件。
- Skeleton / Spine / Live2D / 3D 渲染器**未实现**：`RendererAdapter` 已预留接口与适配器注册机制，需要明确授权的 runtime/资源后方可接入；UI 中相应能力显示为「未支持」，不会伪装为已支持。
- 分支：播放器支持交互选择；离线导出使用当前播放路径（默认 = 每个选择节点取第一个选项），导出时指定分支路径为下一阶段目标。
- 节点图暂无平移/缩放（节点坐标自由布局）；v1 时间轴项目以兼容模式播放（求值回退），不支持节点化自动转换。
- 前端（浏览器 mock 模式）的 Playwright UI 流程测试在 v2 节点化后待回归（见 e2e/README.md）；Tauri mock 集成测试（`src-tauri/tests/ipc_test.rs`）在部分 MSVC 环境下存在运行时加载问题（0xc0000139），其命令层编译验证由 `cargo build` 覆盖，逻辑验证由 `cargo test -p studio-core` 覆盖。
- 预览播放为「按帧求值 + 追赶」模型：若 IPC 往返慢于帧间隔会跳帧，不影响求值确定性。

## 许可与合规

- 本项目不捆绑、不下载、不分发任何第三方游戏资源、角色模型、音频或动画。
- 所有素材来自用户主动导入的本地文件。
- FFmpeg 为运行环境检测到的外部工具，不随应用分发。
- 若将来接入 Spine：必须做成可替换适配器，且不捆绑 / 不依赖未明确授权的 Spine 转换插件、runtime 或资源。
