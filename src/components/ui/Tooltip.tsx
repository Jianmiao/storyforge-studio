import React from "react";

/** 轻量 Tooltip：hover 显示（CSS ::after）。所有图标按钮必须包裹本组件。 */
export function Tooltip({ tip, children }: { tip: string; children: React.ReactNode }) {
  return (
    <span className="tooltip-wrap" data-tip={tip}>
      {children}
    </span>
  );
}
