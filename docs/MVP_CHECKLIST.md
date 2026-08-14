# 第一阶段 MVP 验收清单

状态图例：⬜ 未开始 · 🔄 进行中 · ✅ 通过（含验证方式） · ⛔ 未通过

## A. 项目与编辑核心

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| A1 | 可新建 / 保存 / 打开 `StudioProject v1` 项目 | ✅ | vitest roundtrip + Playwright 保存/打开 |
| A2 | 格式版本与迁移机制（v0 夹具 → v1） | ✅ | vitest + cargo test（migrate 双实现） |
| A3 | 命令模式 Undo/Redo（上限 100，同类命令合并） | ✅ | vitest（合并/上限/redo 清空） |
| A4 | 自动保存：原子写 + 轮换备份 + 崩溃恢复 | ✅ | cargo test（原子 roundtrip / bak 轮换 / 损坏恢复） |
| A5 | 素材索引：哈希、尺寸、时长、缺失状态 | ✅ | cargo test + Rust 实现（sha256 / image dims / symphonia 时长） |

## B. 时间轴与求值

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| B1 | 帧号模型：固定 FPS、精确时间换算 | ✅ | cargo test（插值/区间/钳制） |
| B2 | 8 类轨道：背景 / 角色 / 镜头 / 字幕 / BGM / 语音 / 音效 / 特效 | ✅ | Playwright（8 轨道可见）+ 求值测试 |
| B3 | 片段区间、关键帧插值、4+1 缓动曲线 | ✅ | cargo test（linear/easeIn/easeOut/easeInOut/cubic） |
| B4 | 通用角色动作：进入 / 离开 / 待机摆动 / 抖动 / 跳跃 / 闪白 / 强调缩放 / 表情切换 | ✅ | cargo test（fadeIn / sway 数值断言；其余实现） |
| B5 | 特效：颜色滤镜 / 模糊 / 暗角 / 屏幕闪烁 / 画面震动 / 转场 | ✅ | cargo test（shake 相机偏移）+ 导出目测 |
| B6 | 预览与离线渲染共用同一求值逻辑（Rust 单一实现） | ✅ | 架构审查（ARCHITECTURE.md D1；预览经 IPC 取同一 SceneDescriptor） |
| B7 | 播放不依赖浏览器帧率作为时间来源 | ✅ | 实现审查（帧号求值 + performance.now 单调时钟 + 追赶跳帧） |

## C. 渲染器

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| C1 | `RendererAdapter` 接口隔离 PixiJS | ✅ | 代码审查（src/preview/RendererAdapter.ts） |
| C2 | 预览：图片背景 / 角色 / 变换 / 淡入淡出 / 镜头 / 字幕 | ✅ | Playwright（画布渲染）+ 目测 |
| C3 | 未来骨架渲染器接口预留，未授权不伪造 | ✅ | 代码审查 + README（适配器注册表设计） |

## D. 离线渲染

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| D1 | 固定步进离线渲染（非录屏），背景任务不卡 UI | ✅ | sf_export CLI + jobs.rs worker 线程 |
| D2 | 分辨率 / FPS / 编码 / 码率 / 输出路径可选 | ✅ | CLI 参数 + UI 对话框 |
| D3 | FFmpeg 检测与缺失状态 UI 显示 | ✅ | Playwright（缺失提示 + 手动路径检测）+ ffmpeg.rs |
| D4 | 进度 / 总帧数 / ETA / 取消 / 失败原因 | ✅ | CLI 进度行 + UI 队列（进度/ETA/取消/错误） |
| D5 | 渲染队列与批量导出 | ✅ | jobs.rs 顺序队列 + UI 队列面板 |
| D6 | 取消后临时文件清理 | ✅ | render.rs（cancel → kill → 清理 .part/.audio） |
| D7 | 演示项目（自包含，本地合成素材） | ✅ | demo.rs（渐变/剪影/正弦音，全部本地生成） |
| D8 | **验收样例：≥10s、1080p、30fps、带字幕和音频的 MP4；帧数 / 时长 / 音画同步正确** | ✅ | ffprobe：nb_frames=360、12.0s、AAC 12.0s、偏差 0；verify-export 含音频信号与字幕对比度检测 |

## E. 编辑器 UI

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| E1 | 首屏为工作台（无落地页） | ✅ | Playwright（自动新建空项目，.app-shell 可见） |
| E2 | 左侧资源库 / 场景列表 / 导入；中间画布（拖拽、缩放、参考线）；右侧属性面板；底部多轨时间轴 | ✅ | Playwright + 实现（拖拽/吸附中心/参考线开关） |
| E3 | 顶部操作栏 + 全部图标按钮 tooltip | ✅ | Playwright（aria-label 断言全部按钮） |
| E4 | 快捷键：保存 / 撤销 / 重做 / 播放暂停 / 删除 / 复制粘贴 | ✅ | Playwright（Ctrl+Z / Ctrl+Shift+Z）+ useKeyboard |
| E5 | 深色主题，文本与控件可读 | ✅ | CSS 变量主题 + 目测 |

## F. 素材与兼容

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| F1 | 导入 PNG / JPG / WebP / WAV / MP3 / OGG | ✅ | assets.rs（扩展名白名单 + 解码元数据）；WAV 实测 |
| F2 | 缺失素材检测 + 重新定位 | ✅ | assets.rs（check/relocate）+ UI（缺失徽标/重定位按钮） |
| F3 | 不读取 / 不依赖任何第三方私有格式 | ✅ | 架构审查（无相关代码） |
| F4 | 导入器接口预留（不实现自动提取） | ✅ | 文档（PROJECT_FORMAT §8） |

## G. 测试与文档

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| G1 | 自动化测试：时间轴求值 / 项目迁移 / 撤销重做 / 保存恢复 | ✅ | vitest 25 项 + cargo test 19 项 |
| G2 | README：开发环境 / FFmpeg 配置 / 运行方式 / 架构 / 格式 / 已知限制 | ✅ | README.md + docs/ |
| G3 | Playwright 关键 UI 流程验证 | ✅ | 8/8 通过（msedge channel） |
| G4 | 真实导出样例：视频文件存在且可播放 | ✅ | ffprobe + verify-export（含 volumedetect / 字幕帧检测） |
| G5 | 每个里程碑后构建 / 测试通过 | ✅ | npm run build / vitest / cargo build+test / playwright 全绿 |

## 验证命令速查

```bash
npm run build          # tsc + vite 构建
npm test               # vitest（25 项）
cargo test -p studio-core --manifest-path src-tauri/Cargo.toml   # Rust（19 项）
npm run e2e            # Playwright（8 项，msedge）
npm run verify-export  # 演示项目 → 1080p30 MP4 → ffprobe/信号/字幕检测
```
