// 流程诊断 v2：节点面板选项 / 播放推进 / 分支选择全流程
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 960 } });
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("404")) errors.push(msg.text());
});

await page.goto("http://localhost:1420/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".node-graph-view");
await page.getByRole("button", { name: "创建演示项目" }).click();
await page.waitForSelector('[data-testid="node-nd_choice"]');

// 1) 选中选择节点 → 选项出现在输入框 value 中
await page.getByTestId("node-nd_choice").click();
await page.waitForTimeout(400);
const optionValues = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".props-panel input[type=text]")).map((i) => i.value),
);
console.log("OPTION INPUTS:", JSON.stringify(optionValues));
console.log("PANEL TITLE:", await page.locator(".props-panel .panel-title").first().textContent());

// 2) 播放 1.5s → 播放头推进
await page.getByRole("button", { name: "播放 (Space)" }).click();
await page.waitForTimeout(1500);
console.log("BADGE during play:", await page.locator(".playback-badge").textContent());
// 停止
await page.getByRole("button", { name: "停止 (Space)" }).click();
await page.waitForTimeout(300);

// 3) 跳转到第 3 行（240 帧，对话结尾）→ 播放 → 应触发分支选择
const seqBlocks = page.locator(".seq-block");
console.log("SEQ blocks:", await seqBlocks.count());
await seqBlocks.nth(2).click();
await page.waitForTimeout(300);
console.log("BADGE after seek:", await page.locator(".playback-badge").textContent());
await page.getByRole("button", { name: "播放 (Space)" }).click();
await page.waitForSelector('[data-testid="playback-choice"]', { timeout: 15000 });
console.log("CHOICE OVERLAY:", (await page.getByTestId("playback-choice").textContent())?.slice(0, 80));

// 4) 选择选项 2（直接结束）→ 播放继续且字幕为分支 B 文本
await page.getByTestId("choice-option-1").click();
await page.waitForTimeout(1500);
const seqAfter = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".seq-block")).map((b) => b.textContent?.slice(0, 20)),
);
console.log("SEQ AFTER CHOICE:", JSON.stringify(seqAfter));
const badgeAfter = await page.locator(".playback-badge").textContent();
console.log("BADGE after choice:", badgeAfter);
const subText = await page.evaluate(() => {
  const t = document.querySelector(".canvas-host canvas");
  return t ? "canvas-present" : "no-canvas";
});
console.log("CANVAS:", subText);
console.log("ERRORS:", errors.length === 0 ? "none" : JSON.stringify(errors));
await browser.close();
