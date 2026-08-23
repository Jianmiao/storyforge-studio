import { describe, expect, it } from "vitest";
import { migrateProject, migrations, latestFormatVersion } from "./migrate";
import type { ImageClip } from "./types";

function v0Fixture() {
  return {
    meta: { name: "旧项目" },
    canvas: { width: 1920, height: 1080, fps: 30 },
    assets: [
      { id: "ast_1", kind: "image", fileName: "assets/old.png", hash: "abc", width: 100, height: 100 },
    ],
    scenes: [
      {
        id: "scn_1",
        name: "S",
        durationFrames: 300,
        tracks: [
          {
            id: "trk_1",
            kind: "character",
            name: "角色",
            muted: false,
            clips: [
              {
                id: "clp_1",
                type: "image",
                name: "c",
                assetId: "ast_1",
                start: 0,
                duration: 100,
                keyframes: [],
                transform: { position: [100, 200], scale: [2, 3] },
                opacity: 0.5,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("项目迁移", () => {
  it("v0 → v2：补版本、清文件名前缀、迁移 image 属性、补剧本图", () => {
    const doc = migrateProject(v0Fixture());
    expect(doc.formatVersion).toBe(2);
    expect(doc.assets[0].fileName).toBe("old.png");
    const clip = doc.scenes[0].tracks[0].clips[0] as unknown as ImageClip;
    expect(clip.props.x).toBe(100);
    expect(clip.props.y).toBe(200);
    expect(clip.props.scaleX).toBe(2);
    expect(clip.props.scaleY).toBe(3);
    expect(clip.props.opacity).toBe(0.5);
    expect((clip as unknown as Record<string, unknown>).transform).toBeUndefined();
    expect(clip.actions.enter).toBe("none");
    // v2 新增空剧本图
    expect(doc.script.nodes).toEqual([]);
  });

  it("v1 → v2：补剧本图并保留时间轴场景", () => {
    const doc = migrateProject({
      formatVersion: 1,
      meta: { name: "x" },
      canvas: { width: 100, height: 100, fps: 30 },
      assets: [],
      scenes: [{ id: "s1", name: "S", durationFrames: 100, tracks: [] }],
      export: { width: 100, height: 100, fps: 30, videoCodec: "h264", crf: 18, preset: "veryfast", audioBitrateKbps: 192 },
    });
    expect(doc.formatVersion).toBe(2);
    expect(doc.scenes[0].id).toBe("s1");
    expect(doc.script.entryNodeId).toBeNull();
  });

  it("v2 文档原样通过", () => {
    const doc = migrateProject({
      formatVersion: 2,
      meta: { name: "x" },
      scenes: [],
      script: { nodes: [], entryNodeId: null },
    });
    expect(doc.formatVersion).toBe(2);
  });

  it("v2 旧节点行缺少 clubName 时补空字符串", () => {
    const doc = migrateProject({
      formatVersion: 2,
      meta: { name: "x" },
      canvas: { width: 100, height: 100, fps: 30 },
      assets: [],
      scenes: [],
      script: {
        entryNodeId: "n1",
        nodes: [{ id: "n1", type: "script", x: 0, y: 0, title: "S", next: [], lines: [{ id: "l1", text: "x", speaker: "", characters: [], bgAssetId: null, bgEffect: "none", bgmAssetId: null, voiceAssetId: null, soundAssetId: null, transition: "none", durationFrames: 1, placeText: "" }] }],
      },
    });
    expect(doc.script.nodes[0].lines?.[0].clubName).toBe("");
  });

  it("更高版本拒绝打开", () => {
    expect(() => migrateProject({ formatVersion: 99 })).toThrow(/高于当前/);
  });

  it("缺少 formatVersion 按 v0 兼容迁移", () => {
    // 历史夹具无 formatVersion：视为 v0，迁移后到 v2
    const doc = migrateProject({ meta: { name: "旧" }, canvas: { width: 100, height: 100, fps: 30 }, assets: [], scenes: [] });
    expect(doc.formatVersion).toBe(2);
    expect(doc.script.nodes).toEqual([]);
  });

  it("迁移链注册表完整", () => {
    expect(latestFormatVersion()).toBe(2);
    expect(migrations.map((m) => `${m.from}->${m.to}`)).toEqual(["0->1", "1->2"]);
  });
});
