import type { MapProvider } from "./map-provider.js";

interface MapCameraPolicy {
    readonly supportsHeadingUp: boolean;
    readonly maxPitch: number;
    orient(bearing: number, pitch: number): { bearing: number; pitch: number };
}

interface MapProviderDefinition {
    readonly camera: MapCameraPolicy;
    readonly supportsAppearanceSettings: boolean;
    readonly usesSelectedTheme: boolean;
}

export const MAX_MAP_PITCH_DEG = 70;

const VECTOR_CAMERA: MapCameraPolicy = {
    supportsHeadingUp: true,
    maxPitch: MAX_MAP_PITCH_DEG,
    orient: (bearing, pitch) => ({ bearing, pitch }),
};

const RASTER_CAMERA: MapCameraPolicy = {
    supportsHeadingUp: false,
    maxPitch: 0,
    orient: () => ({ bearing: 0, pitch: 0 }),
};

export const MAP_PROVIDER_REGISTRY = {
    openfreemap: { camera: VECTOR_CAMERA, supportsAppearanceSettings: true, usesSelectedTheme: true },
    "osm-vector": { camera: VECTOR_CAMERA, supportsAppearanceSettings: true, usesSelectedTheme: true },
    "osm-raster": { camera: RASTER_CAMERA, supportsAppearanceSettings: false, usesSelectedTheme: false },
    yandex: { camera: RASTER_CAMERA, supportsAppearanceSettings: false, usesSelectedTheme: false },
} satisfies Record<MapProvider, MapProviderDefinition>;
