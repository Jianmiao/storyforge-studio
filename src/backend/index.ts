import type { BackendAdapter } from "./adapter";

let instance: BackendAdapter | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 后端单一决策点：Tauri 运行时 → tauriAdapter；纯浏览器 → mockAdapter。
 * 选择后整个应用生命周期内不变。
 */
export async function getBackend(): Promise<BackendAdapter> {
  if (instance) return instance;
  if (isTauriRuntime()) {
    const { TauriAdapter } = await import("./tauriAdapter");
    instance = new TauriAdapter();
  } else {
    const { MockAdapter } = await import("./mockAdapter");
    instance = new MockAdapter();
  }
  return instance;
}

export function backendKind(): "tauri" | "mock" | "unknown" {
  if (instance) return instance.kind;
  return isTauriRuntime() ? "tauri" : "mock";
}
