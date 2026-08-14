import { test, expect, type Page } from "@playwright/test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

async function freshApp(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForSelector('[data-testid="timeline"]');
}

test.describe("编辑器 UI 流程（vite + mock 后端）", () => {
  test("首屏为工作台：自动新建项目，显示资源库 / 画布 / 时间轴 / 状态栏", async ({ page }) => {
    await freshApp(page);
    await expect(page.getByTestId("asset-library")).toBeVisible();
    await expect(page.getByTestId("canvas")).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.getByTestId("scene-list")).toBeVisible();
    await expect(page.getByTestId("statusbar")).toBeVisible();
    // 无落地页：主容器即编辑器
    await expect(page.locator(".app-shell")).toBeVisible();
    // 顶部有新建/打开/保存等图标按钮
    expect(await page.locator(".topbar button").count()).toBeGreaterThan(6);
    // 图标按钮都有 tooltip（aria-label 即 tooltip 文本）
    const icons = page.locator(".topbar .icon-btn");
    const count = await icons.count();
    for (let i = 0; i < count; i++) {
      const label = await icons.nth(i).getAttribute("aria-label");
      expect(label, `第 ${i} 个图标按钮缺少 tooltip`).toBeTruthy();
    }
  });

  test("创建演示项目：场景 / 素材 / 轨道片段齐全，可切换场景", async ({ page }) => {
    await freshApp(page);
    await page.getByRole("button", { name: "创建演示项目" }).click();
    await expect(page.getByTestId("asset-ast_bg")).toBeVisible();
    await expect(page.getByTestId("asset-ast_char")).toBeVisible();
    await expect(page.getByTestId("scene-scn_demo")).toBeVisible();
    // 时间轴出现片段块
    await expect(page.getByTestId("clip-clp_bg")).toBeVisible();
    await expect(page.getByTestId("clip-clp_char")).toBeVisible();
    await expect(page.getByTestId("clip-clp_sub1")).toBeVisible();
    // 8 类轨道
    for (const kind of ["background", "character", "camera", "subtitle", "bgm", "voice", "sfx", "effect"]) {
      await expect(page.getByTestId(`lane-${kind}`)).toBeVisible();
    }
    // 播放头初始为 0 帧
    await expect(page.locator(".playback-badge")).toContainText("0000 / 360");
  });

  test("导入本地素材：fixture PNG + WAV", async ({ page }) => {
    await freshApp(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入素材" }).first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles([join(fixtures, "fixture-bg.png"), join(fixtures, "fixture-tone.wav")]);
    await expect(page.locator(".asset-card")).toHaveCount(2);
    await expect(page.locator(".asset-card").first()).toContainText("fixture-bg.png");
    await expect(page.locator(".asset-card").nth(1)).toContainText("fixture-tone.wav");
  });

  test("选中片段 → 属性编辑 → 撤销/重做", async ({ page }) => {
    await freshApp(page);
    await page.getByRole("button", { name: "创建演示项目" }).click();
    // 选中角色片段
    await page.getByTestId("clip-clp_char").click();
    await expect(page.getByTestId("props-panel")).toContainText("角色立绘");
    const xInput = page.getByTestId("prop-props.x");
    await expect(xInput).toHaveValue("960");
    // 修改 X
    await xInput.fill("700");
    await expect(xInput).toHaveValue("700");
    // 撤销 → 恢复
    await page.keyboard.press("Control+z");
    await expect(xInput).toHaveValue("960");
    // 重做 → 再次修改
    await page.keyboard.press("Control+Shift+z");
    await expect(xInput).toHaveValue("700");
    // 播放头不在关键帧上时，静态值生效；验证画布层存在
    await expect(page.locator(".canvas-host canvas")).toHaveCount(1);
  });

  test("播放/暂停：播放头推进（时间源为单调时钟，与帧率解耦）", async ({ page }) => {
    await freshApp(page);
    await page.getByRole("button", { name: "创建演示项目" }).click();
    // 使用顶栏播放按钮（避免 Space 触发焦点按钮的默认行为）
    await page.getByRole("button", { name: "播放 (Space)" }).click();
    await page.waitForTimeout(900);
    const badge = await page.locator(".playback-badge").textContent();
    const frame = Number((badge ?? "").match(/(\d+) \/ 360/)?.[1] ?? 0);
    expect(frame).toBeGreaterThan(10);
    // 暂停后播放头稳定
    await page.getByRole("button", { name: "停止 (Space)" }).click();
    await page.waitForTimeout(500);
    const badge2 = await page.locator(".playback-badge").textContent();
    const frame2 = Number((badge2 ?? "").match(/(\d+) \/ 360/)?.[1] ?? 0);
    await page.waitForTimeout(400);
    const badge3 = await page.locator(".playback-badge").textContent();
    const frame3 = Number((badge3 ?? "").match(/(\d+) \/ 360/)?.[1] ?? 0);
    expect(frame3).toBe(frame2);
    expect(frame2).toBeGreaterThan(0);
  });

  test("保存项目：localStorage 持久化（模拟原子写 + 备份轮换）", async ({ page }) => {
    await freshApp(page);
    await page.getByRole("button", { name: "创建演示项目" }).click();
    await page.getByRole("button", { name: "保存项目" }).click();
    // mock pickSavePath 返回 mock://projects/<名>.storyforge
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k) keys.push(k);
            }
            return keys.some((k) => k.startsWith("sf:mock://projects/") && !k.includes(".bak"));
          }),
        { timeout: 6000 },
      )
      .toBe(true);
    // 再次保存产生轮换备份
    await page.getByRole("button", { name: "保存项目" }).click();
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k) keys.push(k);
            }
            return keys.some((k) => k.includes(".bak1"));
          }),
        { timeout: 6000 },
      )
      .toBe(true);
  });

  test("导出对话框：FFmpeg 缺失提示 → 手动指定路径 → mock 后端明确拒绝（不伪装导出）", async ({ page }) => {
    await freshApp(page);
    await page.getByRole("button", { name: "创建演示项目" }).click();
    // 导出需要已保存项目
    await page.getByRole("button", { name: "保存项目" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "导出视频" }).click();
    // 1) 默认检测不到 FFmpeg（mock 环境），导出不可用
    await expect(page.getByTestId("ffmpeg-status")).toContainText("FFmpeg 未找到");
    // 2) 手动指定路径并通过检测
    await page.getByTestId("ffmpeg-manual-path").fill("E:\\ffmpeg\\bin\\ffmpeg.exe");
    await page.getByRole("button", { name: "检测" }).click();
    await expect(page.getByTestId("ffmpeg-status")).toContainText("FFmpeg 可用");
    // 3) 选择输出路径
    await page.getByRole("button", { name: "浏览…" }).click();
    await expect(page.getByTestId("output-path")).toHaveValue(/storyforge-output\.mp4/);
    // 4) 加入队列：mock 后端必须明确失败而非假成功
    await page.getByTestId("enqueue-render").click();
    await expect(page.getByTestId("render-job-job_1")).toContainText("mock 后端不支持离线渲染");
  });

  test("时间轴缩放与播放头跳转", async ({ page }) => {
    await freshApp(page);
    await page.getByRole("button", { name: "创建演示项目" }).click();
    // 时间轴放大两档
    await page.getByRole("button", { name: "放大" }).click();
    await page.getByRole("button", { name: "放大" }).click();
    await expect(page.locator(".timeline-header")).toContainText("16px/帧");
    // 播放头时间显示
    await expect(page.locator(".timeline-header")).toContainText("00:00.000");
  });
});
