import { describe, expect, it } from "vitest";
import { serializeProject, parseProject, deepEqual } from "./serialize";
import { defaultProject } from "./types";
import { validateProject } from "./schema";
import { buildDemoProject } from "./demo";
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
  it("结构合法且通过校验", () => {
    const doc = buildDemoProject("2026-01-01T00:00:00Z");
    expect(doc.formatVersion).toBe(1);
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0].durationFrames).toBe(360);
    expect(validateProject(doc)).toEqual([]);
    // 关键帧按 path 分组内排序
    for (const scene of doc.scenes) {
      for (const track of scene.tracks) {
        for (const clip of track.clips) {
          const byPath = new Map<string, number[]>();
          for (const k of clip.keyframes) {
            const arr = byPath.get(k.path) ?? [];
            arr.push(k.frame);
            byPath.set(k.path, arr);
          }
          for (const frames of byPath.values()) {
            for (let i = 1; i < frames.length; i++) {
              expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1]);
            }
          }
        }
      }
    }
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

  it("轨道-片段类型不匹配报错", () => {
    const doc = defaultProject("x");
    const track = doc.scenes[0].tracks[0];
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
    const track = doc.scenes[0].tracks[0];
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
