import type { CharacterLineRef, EasingType } from "../domain/types";

/** AA PreviewScene 的五个前景锚点，来自 Slot_F1..F5 的序列化 Transform。 */
export const AA_FOREGROUND_SLOT_OFFSETS = [-925, -435, 0, 435, 925] as const;

/**
 * StoryForge 的固定五槽适配。坐标直接沿用 AA 的五个可见前景槽，便于 AI 直接选槽。
 * 旧项目仍走三槽兼容映射，不会因该数组改变位置。
 */
export const PRESENTATION_SLOT_OFFSETS = [-925, -435, 0, 435, 925] as const;
export const AA_STANDBY_LUMINANCE = 0.6;
export const AA_MOVE_SECONDS = 0.5;
export const TYPEWRITER_FRAMES_PER_GRAPHEME = 1;
export const TYPEWRITER_PUNCTUATION_PAUSE_FRAMES = 3;
export const TYPEWRITER_NEWLINE_PAUSE_FRAMES = 6;

const punctuation = new Set(Array.from("，。！？；：、,.!?;:"));

export interface CharacterPresentationState {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  luminance: number;
  zIndex: number;
}

export interface TypewriterState {
  visibleText: string;
  revealCount: number;
  complete: boolean;
}

export function presentationSlotX(slot: number, width: number): number {
  const index = Math.max(1, Math.min(5, Math.trunc(slot))) - 1;
  return width / 2 + (PRESENTATION_SLOT_OFFSETS[index] / 1920) * width;
}

export function legacySlotX(slot: number, width: number): number {
  const ratios = [0.26, 0.5, 0.74] as const;
  const index = Math.max(0, Math.min(2, Math.trunc(slot)));
  return width * ratios[index];
}

export function easeProgress(value: number, easing: EasingType = "easeInOut"): number {
  const t = Math.max(0, Math.min(1, value));
  switch (easing) {
    case "linear":
      return t;
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - (1 - t) ** 3;
    case "easeInOut":
    case "cubic":
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }
}

export function evaluateCharacterPresentation(
  character: CharacterLineRef,
  localFrame: number,
  fps: number,
  width: number,
  height: number,
): CharacterPresentationState {
  const targetSlot = character.endSlot ?? character.startSlot;
  const targetX = targetSlot === undefined
    ? legacySlotX(character.slot, width)
    : presentationSlotX(targetSlot, width);
  const startX = character.startSlot === undefined
    ? targetX
    : presentationSlotX(character.startSlot, width);
  const duration = Math.max(1, character.moveDurationFrames ?? Math.round(fps * AA_MOVE_SECONDS));
  const moveT = easeProgress(localFrame / duration, character.moveEasing ?? "easeInOut");
  const x = startX + (targetX - startX) * moveT;

  let opacity = 1;
  if (character.appear === "hide") opacity = 0;
  if (character.appear === "fadeOut" && moveT >= 1) opacity = 0;

  let luminance = Math.max(
    0,
    Math.min(1, character.luminance ?? (character.highlighted === false ? AA_STANDBY_LUMINANCE : 1)),
  );
  if (character.appear === "fadeIn") luminance *= moveT;
  if (character.appear === "fadeOut") luminance *= 1 - moveT;
  const closeupScale = character.closeup ? 1.12 : 1;

  return {
    x,
    y: height * (character.closeup ? 0.6 : 0.58),
    scale: Math.max(0.01, character.scale) * closeupScale,
    opacity: Math.max(0, Math.min(1, opacity)),
    luminance,
    zIndex: character.onTop ? 2_000 : character.closeup ? 1_500 : 100 + Math.trunc(character.endSlot ?? character.slot),
  };
}

export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (item) => item.segment);
  }
  return Array.from(text);
}

export function evaluateTypewriter(text: string, localFrame: number): TypewriterState {
  const graphemes = splitGraphemes(text);
  let budget = Math.max(0, Math.floor(localFrame));
  let revealCount = 0;

  for (const grapheme of graphemes) {
    const cost = TYPEWRITER_FRAMES_PER_GRAPHEME
      + (grapheme === "\n" ? TYPEWRITER_NEWLINE_PAUSE_FRAMES : punctuation.has(grapheme) ? TYPEWRITER_PUNCTUATION_PAUSE_FRAMES : 0);
    if (budget < cost) break;
    budget -= cost;
    revealCount += 1;
  }

  return {
    visibleText: graphemes.slice(0, revealCount).join(""),
    revealCount,
    complete: revealCount >= graphemes.length,
  };
}
