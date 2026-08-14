// 诊断：打开 StoryForge 页面，收集 console 错误 / 页面异常 / DOM 状态 / 截图
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 960 } });
const logs = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  }
});
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto("http://localhost:1420/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
  const q = (s) => !!document.querySelector(s);
  return {
    bodyChildren: document.getElementById("root")?.children.length ?? 0,
    appShell: q(".app-shell"),
    nodeGraph: q(".node-graph-view"),
    graphNodes: document.querySelectorAll(".graph-node").length,
    svgPaths: document.querySelectorAll(".node-graph-view svg path").length,
    previewDock: q(".preview-dock"),
    canvasEls: document.querySelectorAll(".canvas-host canvas").length,
    propsPanel: q(".props-panel"),
    timeline: q(".timeline-panel"),
    seqBlocks: document.querySelectorAll(".seq-block").length,
    playhead: q(".playhead-line"),
    rootHTML: (document.getElementById("root")?.innerHTML ?? "").slice(0, 200),
  };
});

await page.screenshot({ path: "e2e/.tmp/diag-screen.png" });
console.log("STATE:", JSON.stringify(state, null, 1));
console.log("LOGS:");
for (const l of logs) console.log("  " + l);
await browser.close();
