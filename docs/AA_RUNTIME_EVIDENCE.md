# AA 鉴赏模式运行时证据（0.8.8）

本文只记录为 StoryForge 独立实现所需的行为证据。仓库不包含 AA 二进制、数据库、Unity 素材、完整解包目录或不可运行的 IL2CPP C# 声明桩。

## 输入指纹

| 只读输入 | SHA-256 |
| --- | --- |
| `GameAssembly.dll` | `DE295666A237DDFBCF9AE3190EF8A8A4A8D89F303C348F7B93B19DE26249B783` |
| `global-metadata.dat` | `62F57E212CB1D6235E9FB219ABB9E6EDB612FC16F9CBBE0A943E771339EC492F` |
| IL2CPP `script.json` | `7BB87D533E7FDD557166579BF77C02B6EF0273B2CEA7EDBB8BBCD129712DC987` |
| `PreviewScene.unity` | `FF5D3ACCB3221FDCA3A26F69DAE27989049170F81D9390F82921A7A6865923F1` |

RVA 均以 `GameAssembly.dll` 映像基址 `0x180000000` 为基准。反汇编使用 PE RVA 映射与 Capstone x86-64，只读取目标函数附近字节。

## 方法证据

| 方法 | RVA | 已恢复行为 | 可信度 |
| --- | ---: | --- | --- |
| `Test.AdvanceScenario` | `0x724250` | 场景推进器会清理/完成当前动画，解析下一条脚本，调度角色/文本/转场，并更新可推进状态。函数体很大，当前未恢复所有分支。 | 中 |
| `ScenarioUtil.GetSlotPos` | `0x788B00` | 槽号为 1 基；预览模式从 Unity 槽 Transform 链读取世界坐标，非预览分支返回静态位置。越界会走运行时异常路径。 | 高 |
| `CharacterMoveAnimation.Init` | `0x797FC0` | 保存 `fromPos/toPos/duration/relative`；内部槽索引为 `slotNum - 1`。 | 高 |
| `CharacterMoveAnimation` 简化构造 | `0x798900` | 默认移动时长写入 `0.5f`。 | 高 |
| `CharacterMoveAnimation.cctor` | `0x798540` | 建立 5 组 `TweenData(li,ri,lo,ro,o)`；静止前景 X 为 `-925,-435,0,435,925`。进入/退出外侧值见下表。 | 高 |
| `CharacterMoveTask.MoveNext` | `0x7A8EC0` | `duration <= 0` 时直接 `SetPos(to)`；否则配置 TweenPosition 的起点、终点和时长，完成后回调。 | 高 |
| `Character.SetPos(Vector2)` | `0x848CF0` | 写入 X/Y，保留当前 Z。 | 高 |
| `Character.SetPos(Vector3)` | `0x848D60` | 直接写入角色 offset controller 的三维位置。 | 高 |
| `Character.SetLuminance` | `0x848900` | 输入钳制到 `0..1`，写入 raw luminance 后刷新材质；类常量 `standbyLuminanceMultiplier = 0.6`。 | 高 |
| `Character.SetOnTop` | `0x848950` | 维护角色顺序并更新 sorting order；具体 Unity renderer 层号不作为 StoryForge 合同。 | 中高 |
| `Character.SetCloseup` | `0x8485E0` | 通过 TweenPosition/offset controller 切换近景位移；精确 UI 像素依赖运行时组件状态。 | 中 |
| `CharacterFadeAnimation.Complete/Start` | `0x797A40` / `0x797B80` | Start 绑定目标槽并启动协程；Complete 将淡入落到亮度 1，将淡出落到亮度/透明度 0。 | 高 |
| `CharacterFadeTask.MoveNext` | `0x7A8CB0` | 逐帧按 delta time 改变亮度，持续调用 `SetLuminance`，溢出或结束后完成；速率来自运行时静态设置，当前未恢复数值。 | 中高 |
| `CharacterHideAnimation.Complete/Start` | `0x797CD0` / `0x797D90` | 绑定槽后从 `Test.slots` 移除角色并完成，不伪装成可恢复淡出。 | 高 |
| `TextTypewriterAnimation.Complete/Start` | `0x7A6D30` / `0x7A6DB0` | Complete 立即写入目标全文；Start 建立并启动逐字协程。 | 高 |
| `TextFadeInTask.MoveNext` | `0x7AA940` | 每步调用 `ScenarioUtil.GetNextCharPos`，保留富文本标签边界；换行使用独立等待值，其他字符使用普通等待值。精确等待秒数来自运行时静态配置，未从文件常量恢复。 | 高/中 |
| `QueuedTypewriterAnimation.Complete/Cancel/Start` | `0x7A22A0` / `0x7A2140` / `0x7A2700` | 按 `PhoneticText` chunk 创建多个子打字机；当前组全部完成才推进下一组；Complete 写入全部文本，Cancel 取消当前组。 | 高 |

### `CharacterMoveAnimation.TweenData`

| AA 前景槽 | `li` | `ri` | `lo` | `ro` | 静止 `o` |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | -2500 | 3500 | -3000 | 3500 | -925 |
| 2 | -2333 | 3200 | -3000 | 3200 | -435 |
| 3 | -3000 | 2331 | -3000 | 3000 | 0 |
| 4 | -3000 | 3000 | -3000 | 3200 | 435 |
| 5 | -3000 | 3000 | -3000 | 3200 | 925 |

## Unity 场景证据

`PreviewScene.unity` 明确包含 `Slot_F1..Slot_F5` 和 `Slot_B1..Slot_B3`。前景 Transform 的 X 分别为 `-925,-435,0,435,925`，Z 分别为 `-0.9,-1.0,-1.1,-1.05,-0.95`。场景同时包含：

- `Label_Script`、`Label_Name`、`Label_Nickname`、`Label_Place`
- `NextArrow` / `NextArrowIcon`
- 每槽 `Char_Pos`、`TweenController`、`OffsetController`
- 底部 `TextBg`、`Script` 容器以及前景 UI 根

因此姓名、社团/昵称、地点、正文和继续光标应为独立运行时元素，而不是拼接成一段字幕。

## StoryForge 适配决策

AA 文件直接证实的是 **五个前景槽**：`-925,-435,0,435,925`。StoryForge 的标准演出运行时采用同样稳定的五槽 `1..5`，保持与 AA 鉴赏模式的站位一致；这是基于序列化场景值的独立实现，不冒充 AA 原始运行时代码。

兼容策略：旧项目仅有 `slot: 0/1/2` 时继续使用既有的 `0.26W/0.5W/0.74W`；只有出现 `startSlot` 或 `endSlot` 才启用五槽语义。默认移动为证据确认的 `0.5s + easeInOut`。未高亮角色采用证据确认的 `0.6` 亮度。

打字机使用 Unicode grapheme，标点和换行有确定性停顿，且按帧求值，保证预览、暂停和离线渲染一致。AA 的精确普通/换行等待秒数尚未恢复，因此 StoryForge 当前参数是独立、可测试的适配值，不标记为 AA 精确值。
