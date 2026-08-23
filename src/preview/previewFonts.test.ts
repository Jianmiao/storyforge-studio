import { describe, expect, it } from "vitest";
import { parsePreviewFontMode, previewFonts } from "./previewFonts";

describe("preview font themes", () => {
  it("uses HarmonyOS Sans Medium as the default", () => {
    expect(parsePreviewFontMode(null)).toBe("harmony");
    expect(parsePreviewFontMode("unknown")).toBe("harmony");
    expect(previewFonts.harmony.family).toContain("SF HarmonyOS Sans");
  });

  it("preserves existing Noto and Nowar preferences", () => {
    expect(parsePreviewFontMode("noto")).toBe("noto");
    expect(parsePreviewFontMode("nowar")).toBe("nowar");
    expect(previewFonts.noto.family).not.toBe(previewFonts.nowar.family);
  });
});
