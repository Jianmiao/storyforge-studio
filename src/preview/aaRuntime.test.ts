import { describe, expect, it } from "vitest";
import {
  AA_STANDBY_LUMINANCE,
  evaluateCharacterPresentation,
  evaluateTypewriter,
  legacySlotX,
  presentationSlotX,
  splitGraphemes,
} from "./aaRuntime";
import type { CharacterLineRef } from "../domain/types";

function character(overrides: Partial<CharacterLineRef> = {}): CharacterLineRef {
  return { assetId: "char", slot: 1, action: "none", scale: 1, ...overrides };
}

describe("AA presentation runtime", () => {
  it("keeps legacy three-slot projects centered exactly as before", () => {
    expect(legacySlotX(0, 1920)).toBeCloseTo(499.2);
    expect(legacySlotX(1, 1920)).toBe(960);
    expect(legacySlotX(2, 1920)).toBeCloseTo(1420.8);
  });

  it("provides five stable AI-addressable slots matching the AA foreground range", () => {
    expect(Array.from({ length: 5 }, (_, i) => presentationSlotX(i + 1, 1920))).toEqual([
      35, 525, 960, 1395, 1885,
    ]);
  });

  it("moves with eased half-second timing and applies standby luminance", () => {
    const ref = character({ startSlot: 1, endSlot: 5, highlighted: false, moveDurationFrames: 15 });
    const start = evaluateCharacterPresentation(ref, 0, 30, 1920, 1080);
    const middle = evaluateCharacterPresentation(ref, 7.5, 30, 1920, 1080);
    const end = evaluateCharacterPresentation(ref, 15, 30, 1920, 1080);
    expect(start.x).toBe(35);
    expect(middle.x).toBeCloseTo(960);
    expect(end.x).toBe(1885);
    expect(end.luminance).toBe(AA_STANDBY_LUMINANCE);
  });

  it("keeps closeups and on-top characters above ordinary layers", () => {
    const ordinary = evaluateCharacterPresentation(character({ endSlot: 2 }), 30, 30, 1920, 1080);
    const closeup = evaluateCharacterPresentation(character({ endSlot: 2, closeup: true }), 30, 30, 1920, 1080);
    const top = evaluateCharacterPresentation(character({ endSlot: 2, onTop: true }), 30, 30, 1920, 1080);
    expect(closeup.scale).toBeCloseTo(1.12);
    expect(closeup.zIndex).toBeGreaterThan(ordinary.zIndex);
    expect(top.zIndex).toBeGreaterThan(closeup.zIndex);
  });

  it("distinguishes luminance fade from immediate hide", () => {
    const fade = evaluateCharacterPresentation(character({ appear: "fadeOut", moveDurationFrames: 10 }), 5, 30, 1920, 1080);
    const fadeEnd = evaluateCharacterPresentation(character({ appear: "fadeOut", moveDurationFrames: 10 }), 10, 30, 1920, 1080);
    const hidden = evaluateCharacterPresentation(character({ appear: "hide" }), 0, 30, 1920, 1080);
    expect(fade.opacity).toBe(1);
    expect(fade.luminance).toBeCloseTo(0.5);
    expect(fadeEnd.opacity).toBe(0);
    expect(hidden.opacity).toBe(0);
  });

  it("reveals Unicode graphemes and pauses after punctuation and newlines", () => {
    expect(splitGraphemes("A👩‍🚀中")).toEqual(["A", "👩‍🚀", "中"]);
    expect(evaluateTypewriter("你，好", 1).visibleText).toBe("你");
    expect(evaluateTypewriter("你，好", 5).visibleText).toBe("你，");
    expect(evaluateTypewriter("甲\n乙", 8).visibleText).toBe("甲\n");
    expect(evaluateTypewriter("甲\n乙", 9)).toMatchObject({ visibleText: "甲\n乙", complete: true });
  });
});
