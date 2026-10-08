# Managers Reference

All managers live in `src/helpers/`. They were built in a separate editor project and brought over as reusable systems for the game. Each manager is self-contained and can be wired into `main.ts` or your scene files as needed.

---

## Animation

### AnimationManager
**File:** `helpers/animation/AnimationManager.js`

Manages `THREE.AnimationMixer` instances and animation clips. Use this when you need to animate objects with keyframes -- position, rotation, scale, or any property over time.

**Good for:**
- Creating animation clips from keyframe data (no need to author .glb animations)
- Playing, stopping, and looping animations on any `Object3D` target
- Managing multiple independent animations across different objects

**Key methods:**
- `createClipFromKeyframes(target, keyframes, name)` -- builds a `THREE.AnimationClip` from a keyframe map
- `play(name, options)` -- plays a clip with loop/repeat settings
- `stop(name)` -- stops a clip
- `update(deltaTime)` -- advances all mixers (call this in your animation loop)
- `removeTarget(target)` -- cleans up a mixer when an object is destroyed

---

### CutsceneManager
**File:** `helpers/animation/CutsceneManager.js`

Plays cutscenes by moving the camera along spline paths over a set duration. Automatically disables player controls during playback and re-enables them when done.

**Good for:**
- Intro sequences, level transitions, story moments
- Timed camera fly-throughs along curved paths
- Synchronizing audio cues to specific moments in a cutscene

**Key methods:**
- `registerSpline(splineJSON)` / `registerSplineCurve(id, curve)` -- add camera paths
- `registerCutscene(cutsceneJSON)` -- define a cutscene with duration, tracks, and events
- `play(id)` / `pause()` / `resume()` / `stop()` -- playback control
- `update(deltaTime)` -- advances the cutscene (call in your loop)
- Accepts `onStateChange` and `onAudioEvent` callbacks in the constructor

---

### SplineEditor
**File:** `helpers/animation/SplineEditor.js`

Visual editor for spline curves. Renders draggable handles on spline points using `TransformControls`. This is an **editor tool** -- useful during development to design camera paths, not something the player interacts with.

**Good for:**
- Designing and tweaking spline paths visually at dev time
- Debugging cutscene camera routes

**Note:** You likely will not ship this in the final game. It depends on `TransformControls` from Three.js addons.

---

## Audio

### AudioManager
**File:** `helpers/audio/AudioManager.js`

Complete audio system. Handles background music, spatial sound emitters, and one-shot sound effects. Automatically handles the browser autoplay restriction by queuing audio until the first user interaction.

**Good for:**
- Background music with looping and volume control
- Spatial audio -- sound gets quieter as the camera moves away from the emitter position
- One-shot SFX (explosions, pickups, UI clicks)
- Managing audio lifecycle cleanly (has `dispose()`)

**Key methods:**
- `setBgm(settings)` -- start background music (path, volume, loop, autoplay)
- `playBgm()` / `pauseBgm()` / `stopBgm()` -- control background music
- `crossfadeBgm(settings, duration)` -- fade between two tracks over the given seconds; call `update(deltaTime)` to advance the fade
- `playSfx(path, options)` -- play a one-shot sound, optionally at a 3D position
- `registerEmitter(emitter)` -- add a looping spatial sound source
- `update()` -- recalculates spatial volumes based on camera position (call in your loop)
- `dispose()` -- stops everything and cleans up

Music playback waits for browser authorization. Crossfades keep the outgoing
track audible until the incoming track actually starts, suspend both tracks
during pauses, and respect the BGM volume setting throughout.
The constructor's `pauseWithMenu: false` option is reserved for dedicated menu
music; gameplay managers use the default pause behavior.

### Game soundtrack
**File:** [helpers/audio/gameMusic.ts](./src/helpers/audio/gameMusic.ts)

Owns the game's BGM independently of scene disposal, including the M-menu
override, non-looping boss victory cue, and final-boss crossfade.
`main.ts` calls `enterScene(id, sceneData)`, `setMenuOpen(open)`,
`setPaused(paused)` and `update(deltaTime)`. Scenes can provide
`getMusicTrack()` for dynamic cues and `hasBossVictory()` for actual boss defeats.
Each scene instance celebrates its boss only once; loading an already-cleared
boss does not emit a new victory cue. Ordinary sound effects remain scene-owned.

---

## Scene

### SceneManager
**File:** `helpers/scene/SceneManager.js`

The largest manager (405 lines). Manages scene objects defined as JSON -- creates meshes, materials, and lights from data. Supports switching between multiple scenes, full undo/redo history (50 steps), and updating object transforms, materials, triggers, audio, splines, and cutscenes.

**Good for:**
- Data-driven scene construction (define scenes as JSON, build them automatically)
- Switching between levels/scenes with clean teardown
- Undo/redo during development
- Creating `MeshStandardMaterial`, `ShaderMaterial`, and `RawShaderMaterial` from JSON config

**Key methods:**
- `registerScene(id, sceneJSON)` -- register a scene definition
- `switchTo(id)` -- load a scene, teardown the previous one
- `addObject(objectJSON)` / `removeObject(id)` -- modify the scene at runtime
- `updateObjectTransform(id, transform)` -- move/rotate/scale objects
- `updateObjectProperties(id, properties)` -- change materials, physics data
- `undo()` / `redo()` -- step through history
- `createMesh(objectJSON)` -- builds a Three.js mesh from JSON (box, sphere, plane, cylinder, cone, torus)
- `createMaterial(materialJSON)` -- builds materials including custom shaders

**Note:** This manager was designed for an editor. For the game you may want a lighter version that just loads and switches scenes without the undo/redo and property editing. Consider trimming it down.

---

### SceneAssets
**File:** `helpers/scene/SceneAssets.js`

In-memory registry for scripts, shaders, and audio files that a scene references. Generates script templates and manages shader file pairs (vertex + fragment).

**Good for:**
- Keeping track of which scripts/shaders/audio belong to a scene
- Generating boilerplate script classes
- Editor-focused -- manages the file list rather than runtime behavior

**Note:** This is primarily an editor utility. In the game, you will import scripts and shaders directly rather than through this registry.

---

### sceneSchema
**File:** `helpers/scene/sceneSchema.js`

Defines the structure of a scene JSON object and provides validation. Contains `createDefaultScene()` which returns a starter scene with a floor, ambient light, and directional light.

**Good for:**
- Understanding the expected scene JSON format
- Creating new scenes with a valid starting template
- Validating scene data before loading it

**Scene JSON structure:**
```
{
  version: 1,
  id, metadata,
  camera: { position, target },
  cameras: [],
  lights: [{ id, type, color, intensity, position, ... }],
  objects: [{ id, name, type, position, rotation, scale, material, physics }],
  splines: [],
  cutscenes: [],
  triggers: [],
  audio: { bgm, emitters }
}
```

---

### createScene
**File:** `helpers/scene/createScene.js`

One-liner that returns `new THREE.Scene()`. Trivial -- just a consistency wrapper.

---

## Triggers

### TriggerManager
**File:** `helpers/triggers/TriggerManager.js`

Manages trigger zones (box or sphere shapes). Each frame, checks which actor meshes overlap each trigger. Fires `triggerEnter` and `triggerExit` events and runs registered action callbacks.

**Good for:**
- Level transitions (walk into a zone, load the next area)
- Cutscene triggers (player enters a zone, camera takes over)
- Pickup zones, damage areas, checkpoint activation
- Any "something happens when the player walks here" mechanic

**Key methods:**
- `registerTrigger(triggerJSON)` -- create a trigger zone (box or sphere, with position, size)
- `update(actorMeshes)` -- check overlaps each frame (pass in player mesh, enemy meshes, etc.)
- `on(event, callback)` -- listen for `triggerEnter` or `triggerExit`
- `registerAction(name, callback)` -- register a named action that triggers can call
- `setVisible(visible)` -- show/hide debug wireframes

---

## Scripts

### ScriptManager
**File:** `helpers/scripts/ScriptManager.js`

Attaches and detaches script files to scene objects in the scene JSON. Tracks which scripts are bound to which objects and whether they are enabled.

**Good for:**
- Editor workflow -- binding behavior scripts to objects through a UI
- Managing script attachments as data

**Note:** Like SceneAssets, this is editor-focused. In the game you will likely just instantiate your player/enemy classes directly.

---

## Physics

### physics/index.js
**File:** `helpers/physics/index.js`

Public API facade for the physics system. Exports clean functions that delegate to the underlying adapter.

**Exported functions:**
- `initPhysics(options)` -- create the physics world (call once at startup)
- `addRigidBody(mesh, options)` -- add physics to a mesh
- `removeRigidBody(mesh)` -- remove physics from a mesh
- `applyImpulse(mesh, impulse)` -- push a body
- `setVelocity(mesh, velocity)` / `getVelocity(mesh)` -- control/read speed
- `moveKinematic(mesh, position, quaternion)` -- move static/moving platforms
- `beginGrab(mesh)` / `moveGrabbedBody(mesh)` / `endGrab(mesh)` -- drag objects
- `stepPhysics(deltaTime)` -- advance the simulation (call in your loop)
- `onCollision(mesh, callback)` -- listen for collisions
- `setPhysicsEnabled(mesh, enabled)` -- toggle physics on/off

---

### physics/adapters/cannonAdapter.js
**File:** `helpers/physics/adapters/cannonAdapter.js`

Wraps **cannon-es** (WebAssembly physics engine). Handles the full rigid body lifecycle: adding/removing bodies, applying forces, syncing physics state to Three.js meshes each frame.

**Supported colliders:** box, sphere, cylinder, capsule (compound shape)

**Good for:**
- Rigid body physics (falling objects, collisions, bouncing)
- Zero-gravity environments (set gravity to `[0, 0, 0]` for space)
- Grab/drag mechanics (pick up and throw objects)
- Kinematic bodies (moving platforms, doors)
- Collision detection callbacks

**Key details:**
- Default gravity: `[0, -9.81, 0]` (Earth normal). Set to `[0, 0, 0]` for space.
- `stepPhysics(dt)` syncs all dynamic bodies to their meshes automatically
- Mass 0 = static body (floor, walls). Mass > 0 = dynamic body.
- Requires `cannon-es` package (already installed)

---

## Quick Start: Wiring managers into main.ts

```typescript
import { AnimationManager } from './helpers/animation/AnimationManager';
import { AudioManager } from './helpers/audio/AudioManager';
import { TriggerManager } from './helpers/triggers/TriggerManager';
import { initPhysics, stepPhysics } from './helpers/physics/index';

// After creating renderer, camera, scene:
const animations = new AnimationManager();
const audio = new AudioManager({ camera });
const triggers = new TriggerManager(scene);
const physics = initPhysics({ gravity: [0, 0, 0] }); // zero-g for space

// In the animation loop:
animations.update(dt);
audio.update();
triggers.update([player.mesh]);
stepPhysics(dt);
```
