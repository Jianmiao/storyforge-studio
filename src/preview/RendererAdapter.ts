import type { SceneDescriptor } from "../shared/descriptor";

/**
 * RendererAdapter —— 渲染层接口。编辑器 UI 只依赖本接口，不直接依赖 PixiJS。
 * 未来 Skeleton / Spine / Live2D / 3D 渲染器以本接口的替换实现接入（需明确授权）。
 */
export interface RendererAdapter {
  /** 初始化（创建画布并挂载到 container）。width/height 为容器 CSS 像素。 */
  init(container: HTMLElement, width: number, height: number): Promise<void>;

  /** 渲染一帧求值结果。幂等；未初始化时忽略。 */
  renderFrame(d: SceneDescriptor): void;

  /** 画布坐标 ⇄ 场景坐标（项目分辨率坐标）换算。 */
  screenToScene(pt: { x: number; y: number }): { x: number; y: number };
  sceneToScreen(pt: { x: number; y: number }): { x: number; y: number };

  /** 容器尺寸变化（CSS 像素）。 */
  resize(width: number, height: number): void;

  /** 最近一次渲染帧中某图层（clipId）的世界坐标包围盒（轴对齐近似），用于选中/命中。 */
  getLayerBounds(layerId: string): { x: number; y: number; w: number; h: number } | null;

  /** 销毁并释放 GPU 资源。 */
  dispose(): void;
}
