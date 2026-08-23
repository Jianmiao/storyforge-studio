import type { LayerDescriptor } from "../shared/descriptor";

export function resolveLayerAssetUrl(
  layer: LayerDescriptor & { url?: string },
  assetUrls: Readonly<Record<string, string>>,
): string | null {
  return layer.url || assetUrls[layer.assetId] || null;
}
