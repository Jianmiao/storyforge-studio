/** 稳定 ID 生成（无外部依赖）。 */
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // 测试环境兜底（Node < 19 或 jsdom 无 crypto）
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i++) out += CHARS[bytes[i] % CHARS.length];
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomId(8)}`;
}

export function newAssetId(): string {
  return newId("ast");
}

export function newSceneId(): string {
  return newId("scn");
}

export function newTrackId(kind: string): string {
  return newId(`trk_${kind}`);
}

export function newClipId(kind: string): string {
  return newId(`clp_${kind}`);
}
