import { useStore } from "../state/store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}
