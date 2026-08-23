import { describe, expect, it } from "vitest";
import { serializeProject, parseProject, deepEqual } from "./serialize";
import { defaultProject } from "./types";
import { validateProject } from "./schema";
import { buildDemoProject } from "./demo";
import { buildLineSequence, linearizeDefaultPath } from "./graph";
import { ProjectPaths, joinSegments } from "./paths";

describe("序列化 roundtrip", () => {
  it("项目文档 → JSON → 解析 → 相等", () => {
    const doc = defaultProject("往返测试");
    const json = serializeProject(doc);
    const parsed = parseProject(json);
    expect(deepEqual(parsed, doc)).toBe(true);
    expect(json.endsWith("\n")).toBe(true);
  });

  it("非法 JSON 抛错", () => {
    expect(() => parseProject("{ not json")).toThrow();
  });

  it("缺少字段抛错", () => {
    expect(() => parseProject(JSON.stringify({ formatVersion: 1 }))).toThrow();
  });
});

describe("演示项目文档", () => {
  it("结构合法且通过校验（v2 节点式剧本）", () => {
    const doc = buildDemoProject("2026-01-01T00:00:00Z");
    expect(doc.formatVersion).toBe(2);
    expect(doc.script.nodes.length).toBeGreaterThanOrEqual(3);
    expect(doc.script.entryNodeId).toBe("nd_entry");
    expect(validateProject(doc)).toEqual([]);
    // 默认路径总时长 360 帧
    const path = linearizeDefaultPath(doc.script);
    const spans = buildLineSequence(doc.script, path);
    expect(spans.reduce((acc, s) => acc + s.durationFrames, 0)).toBe(360);
    // 选择分支存在
    expect(doc.script.nodes.some((n) => n.type === "selection" && n.options && n.options.length >= 2)).toBe(true);
  });

  it("演示对白固定包含三行预览文本", () => {
    const doc = buildDemoProject("2026-01-01T00:00:00Z");
    const line = doc.script.nodes.find((node) => node.id === "nd_dialog")?.lines?.[0];
    expect(line?.text.split("\n")).toHaveLength(3);
  });
});

describe("结构化路径 API", () => {
  it("joinSegments 拼接", () => {
    expect(joinSegments("D:", "a", "b")).toBe("D:\\a\\b");
    expect(joinSegments("D:\\a", "b")).toBe("D:\\a\\b");
    expect(joinSegments("D:\\a\\", "b")).toBe("D:\\a\\b");
  });

  it("ProjectPaths 布局", () => {
    const p = new ProjectPaths("D:\\proj");
    expect(p.projectFile()).toBe("D:\\proj\\project.storyforge");
    expect(p.backupFile(1)).toBe("D:\\proj\\project.storyforge.bak1");
    expect(p.assetsDir()).toBe("D:\\proj\\assets");
    expect(p.assetFile("a1.png")).toBe("D:\\proj\\assets\\a1.png");
  });
});

describe("结构校验", () => {
  it("默认项目合法", () => {
    expect(validateProject(defaultProject("x"))).toEqual([]);
  });

  function sceneWithTrack(doc: ReturnType<typeof defaultProject>) {
    doc.scenes.push({
      id: "scn_t",
      name: "T",
      durationFrames: 300,
      tracks: [{ id: "trk_t", kind: "background", name: "背景", muted: false, clips: [] }],
    });
    return doc.scenes[0].tracks[0];
  }

  it("轨道-片段类型不匹配报错", () => {
    const doc = defaultProject("x");
    const track = sceneWithTrack(doc);
    // 在 background 轨道放入字幕片段
    track.clips.push({
      id: "clp_bad",
      type: "subtitle",
      name: "坏",
      start: 0,
      duration: 10,
      keyframes: [],
      text: "x",
      x: 0,
      y: 0,
      fontSize: 12,
      color: "#fff",
      align: "center",
      outlineWidth: 0,
      opacity: 1,
    });
    const errors = validateProject(doc);
    expect(errors.some((e) => e.includes("不允许放在"))).toBe(true);
  });

  it("引用不存在的素材报错", () => {
    const doc = defaultProject("x");
    const track = sceneWithTrack(doc);
    track.clips.push({
      id: "clp_bad2",
      type: "image",
      name: "坏",
      start: 0,
      duration: 10,
      keyframes: [],
      assetId: "ast_nope",
      props: {
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
        tint: [255, 255, 255], blur: 0,
        crop: { left: 0, right: 0, top: 0, bottom: 0 },
        flipX: false,
      },
      actions: { enter: "none", idle: "none", exit: "none" },
    });
    expect(validateProject(doc).some((e) => e.includes("不存在的素材"))).toBe(true);
  });
});
