import React from "react";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps {
  tip: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** 图标按钮（自带 tooltip）。 */
export function IconButton({ tip, onClick, disabled, active, children, className }: IconButtonProps) {
  return (
    <Tooltip tip={tip}>
      <button
        type="button"
        className={`icon-btn ${active ? "active" : ""} ${className ?? ""}`}
        onClick={onClick}
        disabled={disabled}
        aria-label={tip}
      >
        {children}
      </button>
    </Tooltip>
  );
}
