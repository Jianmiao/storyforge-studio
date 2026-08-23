export interface DialogueTypography {
  scale: number;
  nameFontSize: number;
  clubFontSize: number;
  placeFontSize: number;
  nameGap: number;
  barOffset: number;
  barWidth: number;
  barHeight: number;
}

export interface DialogueLayout {
  typography: DialogueTypography;
  backdropTop: number;
  dividerY: number;
  bodyTop: number;
  bodyLineHeight: number;
}

/** Keep the 1080p nameplate hierarchy stable across scene resolutions. */
export function getDialogueTypography(sceneHeight: number, bodyFontSize: number): DialogueTypography {
  const scale = Math.max(0.5, sceneHeight / 1080);
  const bodyScale = Math.max(0.85, Math.min(1.2, bodyFontSize / 52));
  return {
    scale,
    nameFontSize: Math.round(48 * scale * bodyScale),
    clubFontSize: Math.round(36 * scale * bodyScale),
    placeFontSize: Math.round(24 * scale * bodyScale),
    nameGap: 22 * scale,
    barOffset: 22 * scale,
    barWidth: 8 * scale,
    barHeight: 62 * scale,
  };
}

/** Position the translucent dialogue panel and leave room for three body lines. */
export function getDialogueLayout(sceneHeight: number, bodyFontSize: number): DialogueLayout {
  const typography = getDialogueTypography(sceneHeight, bodyFontSize);
  const { scale } = typography;
  return {
    typography,
    backdropTop: sceneHeight - 460 * scale,
    dividerY: sceneHeight - 230 * scale,
    bodyTop: sceneHeight - 220 * scale,
    bodyLineHeight: Math.round(bodyFontSize * 1.17),
  };
}

/** Offset from the body top to the visual center of the final-line caret. */
export function getDialogueCaretOffset(lineCount: number, lineHeight: number, bodyFontSize: number): number {
  return Math.round(Math.max(0, lineCount - 1) * lineHeight + bodyFontSize * 0.7);
}

/** The continuation caret uses the same height as the dialogue font. */
export function getDialogueCaretHeight(bodyFontSize: number): number {
  return bodyFontSize;
}

/** Keep the continuation caret visually light beside the dialogue text. */
export function getDialogueCaretWidth(scale: number): number {
  return 10 * scale;
}
