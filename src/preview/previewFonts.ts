export type PreviewFontMode = "harmony" | "noto" | "nowar";

export interface PreviewFontDefinition {
  label: string;
  family: string;
}

export const previewFonts: Record<PreviewFontMode, PreviewFontDefinition> = {
  harmony: {
    label: "HarmonyOS Sans Medium",
    family: '"SF HarmonyOS Sans", "SF HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
  },
  noto: {
    label: "Noto Sans",
    family: '"SF Noto Sans SC", "Microsoft YaHei", sans-serif',
  },
  nowar: {
    label: "Nowar Rounded",
    family: '"SF Nowar Rounded", "Microsoft YaHei", sans-serif',
  },
};

export function parsePreviewFontMode(value: string | null): PreviewFontMode {
  return value === "noto" || value === "nowar" || value === "harmony" ? value : "harmony";
}

export async function loadPreviewFont(mode: PreviewFontMode): Promise<string> {
  const definition = previewFonts[mode];
  if (typeof document !== "undefined" && document.fonts) {
    await Promise.all([
      document.fonts.load(`500 48px ${definition.family}`, "鉴赏字体测试"),
      document.fonts.load(`700 48px ${definition.family}`, "Dialogue Font Test"),
    ]);
    await document.fonts.ready;
  }
  return definition.family;
}
