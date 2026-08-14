# Playwright 测试说明

## 默认路径：vite + mock 后端（浏览器开发模式）

```bash
npm run e2e
```

- 由 `playwright.config.ts` 自动启动 `npm run dev`（http://localhost:1420）。
- 时间轴求值走 `BrowserFallbackEvaluator`（DEV 替身，见 `src/dev/stubEvaluator.ts` 头部说明）。
- 覆盖 UI 流程：工作台布局、演示项目、素材导入、选中/属性编辑、撤销/重做、播放/暂停、保存、导出对话框（mock 明确拒绝渲染，不伪装）。
- 数值正确性不在本路径断言（由 `cargo test` 与 `npm run verify-export` 负责）。

## 增强路径：真实 Tauri 桌面端（可选）

真实桌面端使用 WebView2（Edge 内核），可通过 CDP 驱动：

```bash
# 1) 启动 tauri dev 并开启 WebView2 远程调试端口
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
npm run tauri dev
# 2) 用 Playwright 连接
node e2e/connect-cdp.mjs
```

说明：此路径验证真实 Rust 求值 + 真实 IPC + 真实 FFmpeg 导出；当前仓库默认自动化走 vite+mock 路径，以保证 CI 无需 GUI 即可运行。导出管线本身由 `sf_export` CLI + `npm run verify-export` 在无 GUI 条件下完整验证。
