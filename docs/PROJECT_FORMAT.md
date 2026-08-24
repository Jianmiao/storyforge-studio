# StudioProject 项目格式规范

版本：v2（节点式剧情编辑） · 本文档是 **TS 类型（`src/domain/types.ts`）与 Rust serde 模型（`crates/studio-core/src/model.rs`）之间的唯一契约**。两侧任何改动必须同步并跑 roundtrip 测试。

## 1. 文件与目录约定

```
<projectDir>/
├── project.storyforge     # 项目文档（本规范描述的 JSON）
├── project.storyforge.bak1..3  # 轮换备份（每次成功保存后轮换，最多 3 份）
└── assets/                # 素材目录：文件名 = <sha256 前 16 位>.<ext>
```

- 内容为 UTF-8 JSON（无 BOM）；扩展名 `.storyforge`。
- 素材引用一律为 `assets/<fileName>`；`originalPath` 仅作来源参考。
- **禁止**用字符串拼接构造路径：TS 侧 `src/domain/paths.ts`，Rust 侧 `PathBuf`。

## 2. 顶层结构（v2）

```jsonc
{
  "formatVersion": 2,
  "meta": { "name": "未命名项目", "createdAt": "...", "updatedAt": "..." },
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "assets": [ /* AssetRecord[] */ ],
  "script": { /* ScriptGraph：剧本节点图（权威剧本） */ },
  "scenes": [ /* v1 遗留时间轴；v2 新项目为空数组 */ ],
  "export": { /* ExportConfig */ }
}
```

## 3. 剧本节点图（v2 核心）

### 3.1 ScriptGraph

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `nodes` | GraphNode[] | 节点集合 |
| `entryNodeId` | string? | 演出起点（entry 节点 id） |

### 3.2 GraphNode（单结构，可选字段按 type 生效）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 如 `nd_1a2b3c` |
| `type` | `entry \| script \| selection \| exit` | 节点类型 |
| `x` / `y` | number | 节点图画布坐标 |
| `title` | string | 节点标题 |
| `header` | string? | entry：副标题 |
| `endText` | string? | exit：结局文本 |
| `lines` | ScriptLine[]? | script：有序演出行 |
| `options` | string[]? | selection：选项文本（与 `next` 索引对齐） |
| `next` | string[] | 输出连接（目标节点 id）：entry/script 0..1；selection 0..N；exit 0 |

### 3.3 ScriptLine（演出行：一条完整演出指令）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 如 `ln_xxxx` |
| `text` | string | 台词 / 演出文本（空 = 无字幕） |
| `speaker` | string | 说话人显示名 |
| `clubName` | string | 说话人所属社团/组织，运行时姓名牌以蓝色副标题显示 |
| `characters` | CharacterLineRef[] | 该行在场角色 |
| `bgAssetId` | string? | 背景素材；null = 保持上一行 |
| `bgEffect` | `none \| blur` | 背景特效 |
| `bgmAssetId` | string? | BGM 素材；null = 保持 |
| `voiceAssetId` | string? | 语音素材；null = 无 |
| `soundAssetId` | string? | 音效素材；null = 无 |
| `transition` | `none \| fade` | 行首转场（fade = 黑场淡入 15 帧） |
| `durationFrames` | number | 该行持续帧数（播放/导出按帧求值） |
| `placeText` | string | 地点文本（独立地点标签，不再冒充社团名） |

节点剧本求值还会输出 `SceneDescriptor.presentationDialogues[]`，把姓名、社团、地点和正文分开供鉴赏播放层绘制；旧 `subtitles[]` 继续保留给时间轴兼容模式和旧消费者。

### 3.4 CharacterLineRef

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `assetId` | string | 角色图片素材 |
| `slot` | 0 \| 1 \| 2 | 旧工程三槽：左 / 中 / 右；新工程仍保留用于兼容 |
| `action` | `none \| sway \| shake \| jump \| pulse \| flashWhite` | 待机动作 |
| `scale` | number | 缩放（1 = 原尺寸） |
| `startSlot` / `endSlot` | 1..5? | 固定五槽起止位置；任一字段存在即启用五槽语义 |
| `appear` | string? | `none \| fadeIn \| fadeOut \| hide \| move` |
| `moveDurationFrames` | number? | 移动时长；缺失为 0.5 秒 |
| `moveEasing` | EasingType? | 缺失为 `easeInOut` |
| `highlighted` / `luminance` | boolean? / 0..1? | 高亮与显式亮度；未高亮默认 0.6 |
| `onTop` / `closeup` | boolean? | 顶层与近景状态 |
| `faceId` / `shapeOverride` | string? | 适配器保留的表情与形态标识 |

## 4. 求值语义（Rust `graph` + `timeline`，预览/导出共享）

1. **线性化（默认路径）**：`linearize_default_path`：从 entry 起，沿 `next[0]` 顺序前进；selection 取第一个选项；断链即止（不补全其他分支）。
2. **行序列**：路径上所有 script 节点的 lines 依次展开，累计全局帧区间（`startFrame`, `durationFrames`）。
3. **按帧求值** `evaluate(project, path, frame)`：
   - 定位 `frame` 所在行；行内局部帧 `lf`。
   - **背景 / BGM 状态继承**：取当前行及之前最近的 `bgAssetId` / `bgmAssetId`（未指定即保持）。
   - 背景层铺满画布；旧角色按三槽摆放，新角色按 AA 兼容的固定五槽摆放；求值器输出进退场、0.6 待机亮度、近景与稳定层级。待机动作包括 sway / shake / jump / pulse / flashWhite。
   - 结构化对白按 Unicode grapheme 逐字显示，标点与换行有确定性停顿；姓名、社团、地点、正文和完成光标独立绘制。
   - 转场：行首 `fade` → 前 15 帧黑场淡入（transition effect）。
   - 背景特效 `blur` → 全屏模糊 effect。
   - 音频：BGM 从设置行持续到结尾（淡入 30 帧 / 淡出 60 帧）；语音/音效在行区间内播放。
   - 输出：`SceneDescriptor`（与时间轴求值同构；预览 PixiJS 与离线合成共用）。
4. **分支**：播放器遇到 selection（某 script 节点播完且 next 指向 selection）时暂停并弹出选项；选择后重建路径（前缀 + selection + 目标 + 目标默认后续）。离线导出使用调用方传入的 `path`（空 = 默认路径）。
5. **时间轴回退**：无剧本图（v1 迁移项目）时，`evaluate` 回退 `timeline::evaluate`（scenes 结构，见 §6）。

## 5. 版本与迁移

- `formatVersion` 当前为 `2`。迁移链：`0 → 1 → 2`。
  - `v0 → v1`：补 formatVersion；素材 fileName 去 `assets/` 前缀；image clip 扁平字段 → props。
  - `v1 → v2`：补 `script` 空剧本图（`{ nodes: [], entryNodeId: null }`）；`scenes` 保留为兼容数据（求值回退）。
- 加载流程：读 JSON → 按链迁移 → 校验（`validateProject`）→ 进入编辑器。
- 打开未知更高版本：拒绝并提示。
- 写入始终为当前 `FORMAT_VERSION`。

## 6. v1 时间轴兼容结构（scenes，仅回退求值）

与 v1 规范一致：`scenes[].tracks[].clips[]`（背景/角色/镜头/字幕/BGM/语音/音效/特效 8 类轨道；片段 start/duration/keyframes/easing/actions）。v2 新项目不产生；迁移项目保留原样。

## 7. 持久化语义（原子写 / 备份 / 恢复）

1. 写 `<path>.tmp-<pid>` → `flush` → `rename`（同卷原子替换）。
2. 保存后轮换备份：`.bak1` → `.bak2` → `.bak3`（丢弃最旧）。
3. 打开时主文件解析失败 → 依次尝试 `.bak1..3`，返回 `{ project, recoveredFrom }`；残留 `.tmp-*` 自动清理。
4. 自动保存：前端命令提交后 debounce 1.5s 触发。

## 8. 示例（演示项目节选：节点式剧本）

```jsonc
{
  "formatVersion": 2,
  "meta": { "name": "演示项目", "createdAt": "...", "updatedAt": "..." },
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "assets": [ /* ast_bg / ast_char / ast_bgm / ast_sfx */ ],
  "script": {
    "entryNodeId": "nd_entry",
    "nodes": [
      { "id": "nd_entry", "type": "entry", "x": 60, "y": 260, "title": "开场", "header": "演示剧本", "next": ["nd_open"] },
      {
        "id": "nd_open", "type": "script", "x": 300, "y": 260, "title": "开场演出", "next": ["nd_dialog"],
        "lines": [
          {
            "id": "ln_open", "text": "夜色降临，故事开始。", "speaker": "",
            "characters": [ { "assetId": "ast_char", "slot": 1, "action": "sway", "scale": 1 } ],
            "bgAssetId": "ast_bg", "bgEffect": "none", "bgmAssetId": "ast_bgm",
            "voiceAssetId": null, "soundAssetId": null,
            "transition": "fade", "durationFrames": 120, "placeText": "小镇广场"
          }
        ]
      },
      {
        "id": "nd_choice", "type": "selection", "x": 780, "y": 260, "title": "选择",
        "options": ["进入支线剧情", "直接结束"], "next": ["nd_branchA", "nd_branchB"]
      },
      { "id": "nd_exit", "type": "exit", "x": 1260, "y": 260, "title": "结束", "endText": "全剧终", "next": [] }
    ]
  },
  "scenes": [],
  "export": { "width": 1920, "height": 1080, "fps": 30, "videoCodec": "h264", "crf": 18, "preset": "veryfast", "audioBitrateKbps": 192 }
}
```

## 9. 扩展性预留

- 素材 `kind` 可扩展 `video`；演出行可扩展 `camera`（镜头指令）与 `effect`（特效指令）。
- 节点类型可扩展（如 `condition` 条件节点）—— 需同步 Rust/TS 两侧 + 迁移。
- 用户自定义导入器接口（未来）：`ImportAdapter { canHandle(path); import(path) }` 注册表；不实现任何私有格式的自动提取。
- 骨架渲染（Spine/Skeleton）作为 `RendererAdapter` 替换实现接入，需明确授权；未授权不伪装支持。
