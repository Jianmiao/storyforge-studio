import { describe, expect, it } from "vitest";
import { applyEasing } from "./easing";

describe("缓动曲线", () => {
  it("线性", () => {
    expect(applyEasing(0, { type: "linear" })).toBe(0);
    expect(applyEasing(0.5, { type: "linear" })).toBe(0.5);
    expect(applyEasing(1, { type: "linear" })).toBe(1);
  });

  it("easeIn = u³", () => {
    expect(applyEasing(0.5, { type: "easeIn" })).toBeCloseTo(0.125, 9);
  });

  it("easeOut = 1-(1-u)³", () => {
    expect(applyEasing(0.5, { type: "easeOut" })).toBeCloseTo(0.875, 9);
  });

  it("easeInOut 对称中点", () => {
    expect(applyEasing(0.5, { type: "easeInOut" })).toBeCloseTo(0.5, 9);
    expect(applyEasing(0.25, { type: "easeInOut" })).toBeCloseTo(1 - applyEasing(0.75, { type: "easeInOut" }), 9);
  });

  it("cubic-bezier 标准曲线中点", () => {
    const e = applyEasing(0.5, { type: "cubic", c1: [0.42, 0], c2: [0.58, 1] });
    expect(e).toBeCloseTo(0.5, 3);
  });

  it("输入越界被钳制", () => {
    expect(applyEasing(-1, { type: "linear" })).toBe(0);
    expect(applyEasing(2, { type: "linear" })).toBe(1);
  });
});
