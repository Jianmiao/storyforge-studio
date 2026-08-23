import { describe, expect, it } from "vitest";
import { getDialogueCaretHeight, getDialogueCaretOffset, getDialogueCaretWidth, getDialogueLayout, getDialogueTypography } from "./dialogueTypography";

describe("getDialogueTypography", () => {
  it("keeps the 1080p nameplate hierarchy balanced", () => {
    expect(getDialogueTypography(1080, 52)).toEqual({
      scale: 1,
      nameFontSize: 48,
      clubFontSize: 36,
      placeFontSize: 24,
      nameGap: 22,
      barOffset: 22,
      barWidth: 8,
      barHeight: 62,
    });
  });

  it("scales metadata with the scene while preserving readable minimums", () => {
    const typography = getDialogueTypography(540, 42);
    expect(typography.scale).toBe(0.5);
    expect(typography.nameFontSize).toBe(20);
    expect(typography.clubFontSize).toBe(15);
    expect(typography.placeFontSize).toBe(10);
    expect(typography.barHeight).toBe(31);
  });

  it("reserves a three-line bottom dialogue area below the divider", () => {
    expect(getDialogueLayout(1080, 48)).toMatchObject({
      backdropTop: 620,
      dividerY: 850,
      bodyTop: 860,
      bodyLineHeight: 56,
    });
  });

  it("places the continuation caret on the last line", () => {
    expect(getDialogueCaretOffset(1, 56, 48)).toBe(34);
    expect(getDialogueCaretOffset(3, 56, 48)).toBe(146);
  });

  it("matches the caret height to the dialogue text size", () => {
    expect(getDialogueCaretHeight(48)).toBe(48);
  });

  it("keeps the caret narrow at the scene scale", () => {
    expect(getDialogueCaretWidth(1)).toBe(10);
    expect(getDialogueCaretWidth(0.5)).toBe(5);
  });
});
