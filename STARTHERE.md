# START HERE

This document explains how the project is structured and how to add new scenes, scripts, and features.

## How the app boots

`main.ts` is the entry point. It:

1. Creates a `<canvas>` element and appends it to `#app`
2. Calls `createRenderer()`, `createCamera()`, `createControls()` from `core/`
3. Calls `exampleScene.build()` to get a `THREE.Scene`
4. Starts the animation loop: updates controls, updates scene, renders

Everything flows from `main.ts`. If you need to add a new system (physics, audio, post-processing), wire it up here.

## How to create a new scene

Every scene file lives in `src/scenes/` and should export the same three functions:

```typescript
import * as THREE from 'three';

// Create objects, lights, fog, skybox -- add them to the scene
export function build(): THREE.Scene {
  const scene = new THREE.Scene();
  // ... add your objects here
  return scene;
}

// Called every frame -- animate objects, update logic
export function update(dt: number): void {
  // ...
}

// Clean up GPU resources when leaving this scene
export function dispose(): void {
  // geometry.dispose(), material.dispose(), texture.dispose()
}
```

Then in `main.ts`, swap out the import:

```typescript
import * as currentScene from './scenes/yourNewScene';

const scene = currentScene.build();
// in the loop:
currentScene.update(dt);
```

## How to add a player controller

See `src/scripts/player.ts` for the pattern. The `Player` class:

- Creates its own mesh
- Listens for keyboard input
- Exposes an `update(dt)` method called from the animation loop
- Exposes a `dispose()` method for cleanup

To use it:

```typescript
const player = new Player();
scene.add(player.mesh);

// In the animation loop:
player.update(dt);
```

## The core/ folder

| File | Purpose |
|------|---------|
| `renderer.ts` | Creates and configures the `WebGLRenderer`. Shadow maps, tone mapping, pixel ratio. |
| `camera.ts` | Creates the `PerspectiveCamera` with starting position. |
| `controls.ts` | Creates `OrbitControls` for now. Replace with first-person or custom controls when ready. |

## The assets/ folder

Put raw game assets here. They will be bundled into `dist/` by Vite.

- `models/` -- .glb, .obj, .gltf files
- `textures/` -- PNG, JPG texture maps
- `sounds/` -- MP3, OGG audio
- `fonts/` -- .woff2, .ttf web fonts

Reference them with relative paths from your scene files:

```typescript
loader.load('./assets/models/ship.glb', (gltf) => {
  scene.add(gltf.scene);
});
```

## The utils/ folder

- `constants.ts` -- Global config values (camera FOV, colors, shadow map sizes, etc.)

Add shared helper functions here as the project grows.

## Managers (to be added)

The project is set up to accept manager modules that centralize systems like:

- **SceneManager** -- Switch between scenes, handle transitions
- **InputManager** -- Centralized keyboard/mouse state
- **AudioManager** -- Play background music and sound effects
- **AssetManager** -- Preload and cache models, textures, audio
- **UIManager** -- HUD overlays, menus, credits screen

These will live in `src/core/` or `src/managers/` once implemented. Each manager should be a singleton or module that other parts of the code import and call.

## Build and deploy

```bash
npm run build     # outputs to dist/
npx serve dist    # test the production build locally
```

The LAMP server only serves static files. It will not run Node, npm, or any build tools. You upload the contents of `dist/` only.

## Rules for the LAMP server

1. **No absolute paths.** Never start a path with `/`. Always use `./` relative paths.
2. **Case-sensitive filenames.** `Ship.glb` and `ship.glb` are different files on Linux.
3. **Lowercase filenames.** Use `hyphen-separated-lowercase` for all asset names.
4. **Test the build locally first.** Run `npx serve dist` and play through before uploading.
