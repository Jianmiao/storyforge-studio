import { defineConfig } from "@playwright/test";

/**
 * Playwright 配置：默认跑 vite + mock 后端（浏览器开发模式）。
 * 浏览器使用系统 Microsoft Edge（channel: msedge，无需下载 Playwright 浏览器包）。
 * 真实桌面端（Tauri + Rust 求值 + 真实导出）的增强路径见 e2e/README.md。
 */
export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1680, height: 960 },
    trace: "retain-on-failure",
    channel: "msedge",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "msedge", use: { browserName: "chromium", channel: "msedge" } }],
});
