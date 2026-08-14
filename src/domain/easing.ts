import type { Easing } from "./types";

/**
 * 缓动求值：把线性进度 u∈[0,1] 映射为缓动后进度 e∈[0,1]。
 * 与 Rust 侧 crates/studio-core/src/timeline.rs 中的实现保持同一语义（黄金测试覆盖）。
 */

export function applyEasing(u: number, easing: Easing): number {
  const clamped = u <= 0 ? 0 : u >= 1 ? 1 : u;
  switch (easing.type) {
    case "linear":
      return clamped;
    case "easeIn":
      return clamped * clamped * clamped;
    case "easeOut":
      return 1 - Math.pow(1 - clamped, 3);
    case "easeInOut": {
      // cubic ease-in-out
      if (clamped < 0.5) return 4 * clamped * clamped * clamped;
      return 1 - Math.pow(-2 * clamped + 2, 3) / 2;
    }
    case "cubic": {
      const c1 = easing.c1 ?? [0.42, 0];
      const c2 = easing.c2 ?? [0.58, 1];
      return cubicBezierY(clamped, c1, c2);
    }
  }
}

/** 三次贝塞尔（x 轴单调递增假设成立时的标准求解：二分 x(t)=u 求 t，再求 y(t)）。 */
export function cubicBezierY(u: number, c1: [number, number], c2: [number, number]): number {
  const x0 = 0, y0 = 0, x1 = c1[0], y1 = c1[1], x2 = c2[0], y2 = c2[1], x3 = 1, y3 = 1;
  // 快速路径
  if (u <= 0) return y0;
  if (u >= 1) return y3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const xt = bezierX(t, x0, x1, x2, x3);
    if (Math.abs(xt - u) < 1e-6) {
      return bezierY(t, y0, y1, y2, y3);
    }
    if (xt < u) lo = t;
    else hi = t;
  }
  return bezierY((lo + hi) / 2, y0, y1, y2, y3);
}

function bezierX(t: number, x0: number, x1: number, x2: number, x3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
}

function bezierY(t: number, y0: number, y1: number, y2: number, y3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
}

/** 线性插值。 */
export function lerp(a: number, b: number, e: number): number {
  return a + (b - a) * e;
}
