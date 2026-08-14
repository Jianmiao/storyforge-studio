import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { AssetLibrary } from "./components/AssetLibrary";
import { SceneList } from "./components/SceneList";
import { NodeGraphView } from "./components/NodeGraphView";
import { CanvasView } from "./components/CanvasView";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Timeline } from "./components/Timeline";
import { ExportDialog } from "./components/ExportDialog";
import { StatusBar } from "./components/StatusBar";
import { PlaybackChoiceOverlay } from "./components/PlaybackChoiceOverlay";
import { Toast } from "./components/Toast";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useStore } from "./state/store";
import { getBackend } from "./backend";
import { useKeyboard } from "./hooks/useKeyboard";

export default function App() {
  useKeyboard();

  // 启动：检测 FFmpeg + 渲染任务轮询 + 进度事件
  useEffect(() => {
    void useStore.getState().refreshFfmpeg();
    const poll = setInterval(() => {
      void useStore.getState().refreshRenderJobs();
    }, 2000);
    let unsub: (() => void) | null = null;
    void getBackend().then((b) => {
      unsub = b.onRenderProgress(() => {
        void useStore.getState().refreshRenderJobs();
      });
    });
    return () => {
      clearInterval(poll);
      unsub?.();
    };
  }, []);

  // 首屏：工作台（自动新建空项目，非落地页）
  useEffect(() => {
    if (!useStore.getState().document) {
      useStore.getState().newProject();
    }
  }, []);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="left-panel">
        <SceneList />
        <AssetLibrary />
      </div>
      <div className="center-area">
        <ErrorBoundary>
          <NodeGraphView />
          <CanvasView />
          <PropertiesPanel />
        </ErrorBoundary>
      </div>
      <Timeline />
      <StatusBar />
      <ExportDialog />
      <PlaybackChoiceOverlay />
      <Toast />
    </div>
  );
}
