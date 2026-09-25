import { expect, it } from "vitest";

import { MAP_PROVIDER_REGISTRY } from "./map-provider-registry.js";

it.each(["route-only", "openfreemap", "osm-vector"] as const)("%s allows heading-up and tilt", (provider) => {
    const { camera } = MAP_PROVIDER_REGISTRY[provider];
    expect(camera.supportsHeadingUp).toBe(true);
    expect(camera.orient(90, 58)).toEqual({ bearing: 90, pitch: 58 });
    expect(camera.maxPitch).toBeGreaterThanOrEqual(58);
});

it.each(["osm-raster", "yandex"] as const)("%s fixes north and flattens the camera", (provider) => {
    const { camera } = MAP_PROVIDER_REGISTRY[provider];
    expect(camera.supportsHeadingUp).toBe(false);
    expect(camera.orient(90, 58)).toEqual({ bearing: 0, pitch: 0 });
    expect(camera.maxPitch).toBe(0);
});
