# START HERE

This document explains how the test project is structured and how to add new scenes, scripts, and features.

## How the app boots

`main.ts` is the entry point. It:

1. Creates the renderer and appends its canvas to `document.body`.
2. Loads the shared UAL character, then creates Scene 1 (intro/cutscene).
3. Switches to Scene 2 (medical bay) and Scene 3 (passageway) through scene factories.
4. Calls the active scene's `updatePhysics(dt)`, updates character animation/view, then renders.

Third person is the default. V or the HUD button switches views; first person hides the character, including in mirrors. The character model persists across scenes; each playable scene owns its own player controller and physics world.

Everything flows from `main.ts`. If you need to add a new system (physics, audio, post-processing), wire it up here.

## How to create a new scene

Create a `createScene()` factory in the appropriate folder under `src/scenes/`: `level 1/` holds scenes 2–14, `level 2/` holds scenes 15, 15.5 (`scene15-5.ts`), and 16, and `level 3/` holds scenes 17–19. Scene 1 remains at the root. Use this minimal playable-scene pattern from a level folder (not the old `build()` / `Player` class APIs):

```typescript
import * as THREE from 'three';
import { createPlayer } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';

export function createScene() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  const physics = createScenePhysics();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.4, 20),
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
  );
  floor.position.y = -0.2; // Top surface is y = 0.
  scene.add(floor, new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  physics.addBoxFromMesh(floor);

  const player = createPlayer({
    camera, physicsWorld: physics.world,
    spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 0 },
  });
  player.enable();

  return {
    scene, camera, player, physicsWorld: physics.world,
    cutsceneManager: null,
    updatePhysics(dt: number) {
      physics.step(dt, player);
      // Read resolved player positions for gameplay triggers here.
    },
    dispose() {
      player.dispose();
      physics.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
    },
  };
}
```

Wire the factory into `main.ts` using the Scene 2/3 transition pattern: dispose the previous scene, select the new camera/update callback/player, and reparent the shared character. Do not create another render loop or another shared character. Scene 1 is a cutscene, not a player-physics template.

## How to add a player controller

`createPlayer()` in `src/scripts/player.ts` owns input, a nonrotating Cannon sphere, support detection, and the base camera. `characterManager.ts` owns the separate animated GLB. Never move the physics body from an animation or camera script.

## Physics standard for every new playable scene

### Shared simulation contract

- Use `createScenePhysics()`; never copy a scene-specific world or grounding implementation.
- Units are meters and seconds, with +Y upward. Shared values live only in `PHYSICS`: gravity -9.82, radius 0.3, movement 6 m/s, jump speed 7 m/s, maximum walkable slope 50 degrees.
- Call `physics.step(dt, player)` once per render frame. It runs input/movement, Cannon, then support detection at 120 Hz; camera updates follow simulation. Animation reads the resolved state afterward.
- Frame time is capped at 0.1 seconds / 12 substeps. Excess time after a pause is discarded, not simulated as a giant jump. Do not also call `world.step()` or player physics hooks from the scene.
- Player contact restitution and friction are zero. Grounded movement follows the support plane; the controller cancels tangential gravity to hold still on slopes.

### Colliders are the source of truth

- Every walkable floor, landing, ramp, and blocking wall needs an actual collider. A visible mesh is not automatically solid.
- Prefer `physics.addBoxFromMesh(mesh)` after parenting and setting its transform. It derives a static box from `BoxGeometry`. Keep positive scales; do not use sheared transforms or subsequently move/scale the mesh alone.
- `physics.addBox(size, center)` takes full dimensions, not Cannon half extents. All dimensions and transforms must be finite. Position manually constructed bodies before adding them to the world.
- Floors are finite slabs. Share dimensions/top heights with visuals, cover door-transition thresholds, and leave intentional holes genuinely empty. No invisible infinite plane beneath a multilevel scene.
- Support uses upward solid contact normals and a short collider ray, never scene-coordinate rectangles. Walls, ceilings, non-solid triggers, and slopes over 50 degrees are not ground. There are no `addWalkableSurface()` / `addWalkableRamp()` registrations.
- The 0.025 m contact tolerance accommodates solver residuals. The 0.08 m downward snap only maintains nearby support; it is not a step-climbing or floor-teleport mechanism. Intentional jump ascent cannot be snapped back down.
- Spawn on flat ground at `floorTop + PHYSICS.playerRadius`; use `player.setPosition()` for teleports so velocity/support state and collision bounds reset. Add colliders before spawning/enabling the player. Never spawn inside geometry.
- Solids use collision response; sensors do not. Trigger volumes must never act as floors. Keep the player and solid collision masks compatible.

### Stairs and railings

Use `physics.addStaircase({ width, run, rise, position, material, yaw? })` and add its returned `group` to the scene. The returned body is already in the world.

- `position` is the bottom-center edge. The stairs rise along local +Z for `run` meters; `yaw` rotates both the visual and collider.
- One solid convex wedge provides smooth collision. Visual treads are generated from the same dimensions, with default risers no taller than 0.18 m. Do not add separate tread colliders or manually snap player Y.
- The top landing must start exactly at the ramp endpoint and have top height `position.y + rise`. Keep openings at least one player diameter wide plus clearance; test both directions and diagonal approaches.
- Make guard barriers visible. Scene 2 uses glass infill panels with matching box colliders, plus matching rails/posts. Do not add oversized invisible full-height walls along the stairs.
- The sphere remains upright; smooth stair collision does not provide per-foot animation IK. Small tread/foot differences are expected within the visual step size.

### State and lifecycle

- Space is a press event, not automatic repeated jumping while held. `isOnGround` means supported; `jumping` means intentional ascending jump. Uphill velocity and tiny solver corrections do not mean jumping.
- Let the shared character manager select walk/idle/jump from `player.getState()`. Never add a scene-local jump-animation latch or timer.
- Number keys 6-9 fire one-shot action clips (`Sword_Attack`, `Pistol_Shoot`, `Pistol_Reload`, `Dance_Loop`). They arm on a fresh press while grounded, play exactly once through the shared state machine, then locomotion resumes; held keys cannot retrigger and mid-air presses are ignored. Map new actions in player.ts `ACTION_KEYS` and register the clips in characterManager `CLIP_NAMES`/`ACTION_CLIPS`.
- Door callbacks pass `player.captureTransition(doorway)` into the destination factory's `entryState`. Restore it with `player.restoreTransition(state, doorway)` after enabling the new player. Doorway coordinates use floor height and a yaw pointing into the room (default -Z). The handoff preserves relative position/heading, pitch, velocity, held keys, and bobbing; the arrival door starts open.
- Keep the browser's existing pointer lock across scene swaps. New controllers read `document.pointerLockElement`; they must not wait for a new lock event or request another click. Explicit unlock/blur still clears input normally.
- Before the first destination render, align the shared character with `setFacing(player.getState().yaw)` and update the player camera/view. Do not run OrbitControls updates on the gameplay camera.
- On scene exit, capture any handoff state before calling `player.dispose()` and `physics.dispose()` to remove input listeners and bodies. Cancel scene timers/overlays and release owned GPU resources separately. Do not dispose the persistent character's assets.
- This baseline covers static floors, walls, ramps, and player jumping. It does not yet implement a full-height capsule, moving-platform riding, ladders, swimming, fast-projectile CCD, or camera collision. Existing sliding door panels are visual/trigger-driven, not physical moving barriers. Add shared support and regression tests before relying on those mechanics.

### Acceptance gate before calling a scene playable

1. Walk all floors; start slightly above/below the standing height. Standing must settle without false airborne state.
2. Ascend/descend every staircase, cross both ends, stop midway, and press diagonally into its rails. No launch, sinking, hovering, or idle drift.
3. Jump on the ground, upper floor, and slopes. Hold Space through landing; it must not auto-jump. Release WASD and confirm idle returns.
4. Walk off intended ledges. Wall contact and sensors must not keep the player airborne as if supported.
5. Repeat at 30, 60, and 144 FPS and after a long frame. Traverse door thresholds and transition away/back without duplicate input listeners.
6. Add regression cases using the actual scene factory to `tests/scenePhysics.test.mjs`; do not test only an unrelated plane. The existing suite also checks real GLB action weights on Scene 2's stairs.
7. Run `npm test`, `npm run typecheck`, and `npm run build`; then visually play through with `npm run dev`. Headless physics tests do not replace visual checks.

## The core/ folder

`renderer.ts`, `camera.ts`, and `controls.ts` contain starter factory utilities. The current game configures the renderer/OrbitControls in `main.ts` and creates cameras in its scene factories. Use the actual Scene 2/3 integration as the playable-scene reference.

## The assets/ folder

Put raw game assets here. They will be bundled into `dist/` by Vite.

- `models/` -- .glb, .obj, .gltf files
- `textures/` -- PNG, JPG texture maps
- `sounds/` -- MP3, OGG audio
- `fonts/` -- .woff2, .ttf web fonts

Import asset URLs so Vite includes them in the production build. From a scene inside a level folder:

```typescript
import shipUrl from '../../assets/models/ship.glb';

loader.load(shipUrl, (gltf) => {
  scene.add(gltf.scene);
});
```

A runtime string such as `'./assets/models/ship.glb'` does not ensure the asset gets bundled.

## The utils/ folder

- `constants.ts` -- Global config values (camera FOV, colors, shadow map sizes, etc.)

Add shared helper functions here as the project grows.

## Existing helper modules

`src/helpers/` contains imported manager/adaptor modules documented in `MANAGERS.md`. They are not all wired into the game. Playable scenes use the per-scene `helpers/physics/scenePhysics.ts` helper, not the editor-oriented singleton physics facade. Scene transitions currently live in `main.ts`; the audio manager is still a stub.

## Build and deploy

```bash
npm test          # real-model animation and scene physics regressions
npm run typecheck # strict TypeScript checks
npm run build     # outputs to dist/
npm run preview   # test the production build locally
```

The LAMP server only serves static files. It will not run Node, npm, or any build tools. You upload the contents of `dist/` only.

## Rules for the LAMP server

1. **No absolute paths.** Never start a path with `/`. Always use `./` relative paths.
2. **Case-sensitive filenames.** `Ship.glb` and `ship.glb` are different files on Linux.
3. **Lowercase filenames.** Use `hyphen-separated-lowercase` for all asset names.
4. **Test the build locally first.** Run `npx serve dist` and play through before uploading.
