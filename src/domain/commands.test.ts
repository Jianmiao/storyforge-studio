import { describe, expect, it } from "vitest";
import { History } from "./history";
import { AddClipCommand, MoveClipCommand, SetClipPropsCommand, makeClip } from "./commands";
import { defaultProject, type ImageClip, type StudioProject } from "./types";

function setup(): { doc: StudioProject; history: History; sceneId: string; trackId: string } {
  const doc = defaultProject("测试");
  const history = new History();
  return { doc, history, sceneId: doc.scenes[0].id, trackId: doc.scenes[0].tracks[0].id };
}

describe("命令撤销/重做（命令模式）", () => {
  it("添加片段 → 撤销 → 重做", () => {
    const { doc, history, sceneId, trackId } = setup();
    const clip = makeClip({ sceneId, trackId, type: "image", start: 0, duration: 30, assetId: "ast_1" });
    const cmd = new AddClipCommand(sceneId, trackId, clip, 0);
    cmd.apply(doc);
    history.execute(cmd);
    expect(doc.scenes[0].tracks[0].clips).toHaveLength(1);

    history.undo(doc);
    expect(doc.scenes[0].tracks[0].clips).toHaveLength(0);

    history.redo(doc);
    expect(doc.scenes[0].tracks[0].clips).toHaveLength(1);
    expect(doc.scenes[0].tracks[0].clips[0].id).toBe(clip.id);
  });

  it("属性命令合并：连续修改只产生一条可撤销历史", () => {
    const { doc, history, sceneId, trackId } = setup();
    const clip = makeClip({ sceneId, trackId, type: "image", start: 0, duration: 30, assetId: "ast_1" });
    const add = new AddClipCommand(sceneId, trackId, clip, 0);
    add.apply(doc);
    history.execute(add);

    const c1 = new SetClipPropsCommand(sceneId, clip.id, "props.x", 0, 10);
    c1.apply(doc);
    history.execute(c1);
    const c2 = new SetClipPropsCommand(sceneId, clip.id, "props.x", 0, 25);
    c2.apply(doc);
    history.execute(c2);
    const c3 = new SetClipPropsCommand(sceneId, clip.id, "props.x", 0, 40);
    c3.apply(doc);
    history.execute(c3);

    expect((doc.scenes[0].tracks[0].clips[0] as ImageClip).props.x).toBe(40);
    // 4 条命令（add + 1 条合并后的属性命令）
    expect(history.undoDepth()).toBe(2);
    history.undo(doc);
    expect((doc.scenes[0].tracks[0].clips[0] as ImageClip).props.x).toBe(0);
  });

  it("移动命令合并：连续拖动一次撤销", () => {
    const { doc, history, sceneId, trackId } = setup();
    const clip = makeClip({ sceneId, trackId, type: "image", start: 10, duration: 30, assetId: "ast_1" });
    const add = new AddClipCommand(sceneId, trackId, clip, 0);
    add.apply(doc);
    history.execute(add);
    const m1 = new MoveClipCommand(sceneId, clip.id, 10, 15);
    m1.apply(doc);
    history.execute(m1);
    const m2 = new MoveClipCommand(sceneId, clip.id, 10, 22);
    m2.apply(doc);
    history.execute(m2);
    expect(doc.scenes[0].tracks[0].clips[0].start).toBe(22);
    history.undo(doc);
    expect(doc.scenes[0].tracks[0].clips[0].start).toBe(10);
  });

  it("撤销栈上限 100", () => {
    const history = new History(3);
    const { doc } = setup();
    const fake = {
      name: "x",
      apply: (d: StudioProject) => {
        d.meta.name = `v${history.undoDepth()}`;
      },
      undo: (d: StudioProject) => {
        d.meta.name = "orig";
      },
    };
    for (let i = 0; i < 10; i++) {
      fake.apply(doc);
      history.execute(fake);
    }
    expect(history.undoDepth()).toBe(3);
  });

  it("undo 后执行新命令会清空 redo 栈", () => {
    const { doc, history, sceneId, trackId } = setup();
    const clip = makeClip({ sceneId, trackId, type: "image", start: 0, duration: 30, assetId: "ast_1" });
    const add = new AddClipCommand(sceneId, trackId, clip, 0);
    add.apply(doc);
    history.execute(add);
    history.undo(doc);
    expect(history.canRedo()).toBe(true);
    const clip2 = makeClip({ sceneId, trackId, type: "image", start: 5, duration: 30, assetId: "ast_1" });
    const add2 = new AddClipCommand(sceneId, trackId, clip2, 0);
    add2.apply(doc);
    history.execute(add2);
    expect(history.canRedo()).toBe(false);
  });
});
