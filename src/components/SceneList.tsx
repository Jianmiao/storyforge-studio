import { useStore } from "../state/store";

/**
 * 剧本概览（左侧面板上部）：项目级剧本统计与入口设置。
 * （v2 节点式编辑）
 */
export function SceneList() {
  const document = useStore((s) => s.document);

  if (!document) return null;

  const nodeCount = document.script.nodes.length;
  const lineCount = document.script.nodes.reduce((acc, n) => acc + (n.lines?.length ?? 0), 0);
  const selectionCount = document.script.nodes.filter((n) => n.type === "selection").length;

  return (
    <>
      <div className="panel-title">剧本</div>
      <div className="scene-list" data-testid="scene-list">
        <div className="scene-item" style={{ cursor: "default" }}>
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-1)" }}>节点</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-0)" }}>{nodeCount}</span>
        </div>
        <div className="scene-item" style={{ cursor: "default" }}>
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-1)" }}>演出行</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-0)" }}>{lineCount}</span>
        </div>
        <div className="scene-item" style={{ cursor: "default" }}>
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-1)" }}>选择分支</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-0)" }}>{selectionCount}</span>
        </div>
        <div className="scene-item" style={{ cursor: "default" }}>
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-1)" }}>入口</span>
          <span style={{ fontSize: 11, color: "var(--accent)" }}>
            {document.script.nodes.find((n) => n.id === document.script.entryNodeId)?.title ?? "未设置"}
          </span>
        </div>
      </div>
    </>
  );
}
