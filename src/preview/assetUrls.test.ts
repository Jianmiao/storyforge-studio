import { describe, expect, it } from "vitest";
import type { LayerDescriptor } from "../shared/descriptor";
import { resolveLayerAssetUrl } from "./assetUrls";

const layer: LayerDescriptor = {
  id: "layer",
  kind: "image",
  assetId: "ast_char",
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  tint: [255, 255, 255],
  blur: 0,
  crop: { left: 0, right: 0, top: 0, bottom: 0 },
  flipX: false,
  flash: 0,
};

describe("resolveLayerAssetUrl", () => {
  it("resolves a stable asset ID through the runtime URL map", () => {
    expect(resolveLayerAssetUrl(layer, { ast_char: "blob:character" })).toBe("blob:character");
  });

  it("keeps an explicit descriptor URL and does not treat an asset ID as a URL", () => {
    expect(resolveLayerAssetUrl({ ...layer, url: "asset://character" }, { ast_char: "blob:character" })).toBe("asset://character");
    expect(resolveLayerAssetUrl(layer, {})).toBeNull();
  });
});
