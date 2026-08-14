import type { Command, ProjectDraft } from "./commands";

/**
 * 命令历史：undo / redo 栈。
 * 不入 React 状态（命令对象非可序列化 UI 状态）；栈深度以计数器暴露给 UI。
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  /** 入栈（不执行 apply —— 调用方已应用）。尝试与栈顶合并。 */
  execute(cmd: Command): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.merge && top.merge(cmd)) {
      this.redoStack = [];
      return;
    }
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoDepth(): number {
    return this.undoStack.length;
  }

  redoDepth(): number {
    return this.redoStack.length;
  }

  /** 撤销一步（调用方负责把 draft 交给 undo）。 */
  undo(draft: ProjectDraft): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo(draft);
    this.redoStack.push(cmd);
    return cmd;
  }

  /** 重做一步（调用方负责把 draft 交给 apply）。 */
  redo(draft: ProjectDraft): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.apply(draft);
    this.undoStack.push(cmd);
    return cmd;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  peekUndoName(): string | null {
    const top = this.undoStack[this.undoStack.length - 1];
    return top ? top.name : null;
  }

  peekRedoName(): string | null {
    const top = this.redoStack[this.redoStack.length - 1];
    return top ? top.name : null;
  }
}
