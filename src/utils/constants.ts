/**
 * Global configuration constants.
 */
export const CONFIG = {
  // Renderer
  PIXEL_RATIO_CAP: 2,
  SHADOW_MAP_SIZE: 1024,

  // Camera
  FOV: 75,
  NEAR: 0.1,
  FAR: 1000,
  CAMERA_START: { x: 0, y: 5, z: 10 },

  // Scene
  BACKGROUND_COLOR: 0x111122,
  FOG_COLOR: 0x111122,
  FOG_NEAR: 10,
  FOG_FAR: 50,
} as const;
