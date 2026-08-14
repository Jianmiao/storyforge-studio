# 第一阶段 MVP 验收清单（v2 节点式剧情编辑）

状态图例：⬜ 未开始 · 🔄 进行中 · ✅ 通过（含验证方式） · ⛔ 未通过

> 2026-08 方向调整：编辑范式从时间轴剪辑改为**节点式剧情编辑**（借鉴经典节点图设计，独立实现）。
> 原 v1 时间轴能力保留为兼容回退；核心渲染/导出/素材/持久化管线复用。

## A. 项目与编辑核心（v2 节点式）

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| A1 | 可新建 / 保存 / 打开 `StudioProject v2` 项目 | ✅ | vitest roundtrip + Rust IO 测试 |
| A2 | 迁移链 v0→v1→v2（v1 时间轴项目保留回退） | ✅ | vitest + cargo test（双实现） |
| A3 | 命令模式 Undo/Redo（含节点/演出行命令，合并机制） | ✅ | vitest（合并/上限/redo 清空） |
| A4 | 自动保存：原子写 + 轮换备份 + 崩溃恢复 | ✅ | cargo test |
| A5 | 素材索引：哈希、尺寸、时长、缺失状态 | ✅ | cargo test + assets.rs |

## B. 剧本图与求值

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| B1 | 节点类型：entry / script / selection / exit；演出行指令模型 | ✅ | cargo test（graph.rs）+ 文档 |
| B2 | 演出行：台词/说话人/角色槽位+动作/背景/BGM/语音/音效/转场/时长 | ✅ | cargo test（字幕/背景继承/音频） |
| B3 | 默认路径线性化（selection 取第一个选项）与自定义路径 | ✅ | cargo test（分支 A/B 路径） |
| B4 | 分支播放：选择节点暂停 → 重建路径继续 | ✅ | 前端实现（usePlayback + 选择覆盖层） |
| B5 | 预览与离线渲染共用同一求值（graph.rs 单一实现） | ✅ | 架构审查 + IPC 契约 |
| B6 | v1 时间轴回退求值（迁移项目兼容） | ✅ | cargo test（timeline.rs 保留） |

## C. 离线渲染（核心验收）

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| C1 | 固定步进离线渲染（非录屏），后台任务不卡 UI | ✅ | sf_export CLI + jobs.rs |
| C2 | 分辨率 / FPS / 编码 / 码率 / 输出路径可选 | ✅ | CLI 参数 + UI 对话框 |
| C3 | FFmpeg 检测与缺失状态 UI 显示 | ✅ | ffmpeg.rs + UI |
| C4 | 进度 / 总帧数 / ETA / 取消 / 失败原因 / 临时文件清理 | ✅ | CLI + jobs.rs |
| C5 | 渲染队列与批量导出 | ✅ | jobs.rs 顺序队列 |
| C6 | **验收样例：12s、1080p、30fps、带字幕和音频（含分支剧本默认路径）** | ✅ | ffprobe：nb_frames=360、视频/音频 12.0s 同步零偏差；volumedetect -14.7dB；字幕对比度 YMIN16/YMAX235 |
| C7 | 音频解码修复：symphonia codec 特性（pcm/aac/vorbis） | ✅ | cargo test（解码峰值 + 混音输出） |

## D. 编辑器 UI

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| D1 | 首屏为工作台（无落地页） | ✅ | 实现（自动新建项目） |
| D2 | 节点图主视图：节点卡片/连线/拖拽/端口连线/节点增删 | ✅ | NodeGraphView 实现（可编译） |
| D3 | 演出行编辑（属性面板）：台词/角色/背景/音频/转场 | ✅ | LineProps 实现 |
| D4 | 预览浮窗 + 演出序列检查视图（只读）+ 播放分支选择 | ✅ | 实现（可编译） |
| D5 | 顶部操作栏 + 全部图标按钮 tooltip + 快捷键 + 深色主题 | ✅ | 实现 |
| D6 | Playwright UI 流程（节点化后回归） | 🔄 | e2e 待前端打磨后回归（见 README） |

## E. 素材与兼容

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| E1 | 导入 PNG / JPG / WebP / WAV / MP3 / OGG | ✅ | assets.rs + symphonia（已含 codec） |
| E2 | 缺失素材检测 + 重新定位 | ✅ | assets.rs + UI |
| E3 | 不读取 / 不依赖任何第三方私有格式 | ✅ | 架构审查（仅借鉴节点图设计范式） |

## F. 测试与文档

| # | 验收项 | 状态 | 验证方式 |
| --- | --- | --- | --- |
| F1 | Rust 测试：剧本图求值 / 迁移 / 保存恢复 / 音频混音 | ✅ | cargo test 25/25 |
| F2 | vitest：命令 / 迁移 / 序列化 / 校验 / 演示项目 | ✅ | 26/26 |
| F3 | README / ARCHITECTURE / PROJECT_FORMAT（v2） | ✅ | 文档更新完成 |
| F4 | 真实导出样例：文件存在、可播放、帧数/时长/音画/字幕/音频信号 | ✅ | ffprobe + volumedetect + signalstats |

## 验证命令速查

```bash
npm run build          # tsc + vite 构建
npm test               # vitest（26 项）
cargo test -p studio-core --manifest-path src-tauri/Cargo.toml   # Rust（25 项）
npm run verify-export  # 演示项目（节点式，默认路径）→ 1080p30 MP4 → 全项校验
```
