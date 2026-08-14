import React from "react";

/** 简单错误边界：渲染异常时显示错误信息而不是卸载整棵应用树。 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#e5534b", fontSize: 13, fontFamily: "monospace" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>界面渲染出错：</div>
          <div>{this.state.error.message}</div>
          <button
            type="button"
            style={{ marginTop: 12 }}
            onClick={() => {
              this.setState({ error: null });
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
