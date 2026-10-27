# Brondon's Revenge - Development Vlog

**Target runtime: 4 minutes 50 seconds.** Read only the quoted **Voiceover** text; everything else is a filming/editing instruction. The music section reserves 45 seconds for your own explanation and listening examples.

The spoken script is deliberately shorter than a continuous five-minute read: leave space for demonstrations, transitions and music. Record a timed rehearsal rather than rushing to fit every detail.

**Discussion outline:** open [storyboard/index.html](./storyboard/index.html) in a browser for the topics and talking points to cover while making your own recordings. It follows this script's section timings; it does not require screenshots, video uploads or animatic playback. Update both if you change the structure.

## Timeline

| Time | Section | Main footage |
| --- | --- | --- |
| 0:00-0:15 | Introduction | Ship, jungle and combat montage |
| 0:15-0:45 | Gameplay mechanics | Stealth/traversal, surveillance puzzles, combat |
| 0:45-1:20 | Character animations | Third-person locomotion, slide and attacks |
| 1:20-1:50 | Cutscenes | Facility arrival and photograph reveal |
| 1:50-2:25 | Scene layout and environment | Surveillance hub, then jungle |
| 2:25-2:50 | Physics | Slopes, jumping and landing |
| 2:50-3:20 | Weapons menu | Hold, aim, cancel and equip |
| 3:20-3:50 | Camera decisions | Matched first/third-person shots and wall clearance |
| 3:50-4:35 | Original music | Your composition session and in-game examples |
| 4:35-4:50 | Conclusion | Final gameplay montage and title |

## Before recording

- Capture clean gameplay separately from the voiceover, preferably at 1080p/60 fps if your machine can sustain it.
- Start with `npm run dev`. In the pause menu, choose **Developer Mode > Unlock**; no password is required. Developer scene entries grant equipment, so use them to stage weapon demonstrations without replaying the campaign. Do not present that loadout as normal starting progression.
- For the surveillance hub, the development URL `http://localhost:5173/?stage2-hub` provides a checkpoint with the camera minigames ready. Use the actual port printed by Vite if it differs.
- Use **V** to switch the on-foot camera view. Record animation demonstrations in third-person before recording matching first-person shots.
- For environment beauty shots in the Vite development build, **=** opens a paused free-fly camera. Move with **WASD**, rise/descend with **Space/C**, hold **Shift** for speed, and drag to look. Press **=** or **Escape** to restore gameplay. Since this pauses the scene, record moving foliage from the normal live camera.
- Hide HUD through **M > Display > Hide HUD** for beauty shots; restore it for interaction/menu demonstrations.
- Use large editor text, crop to the relevant lines and keep each code insert to roughly 4-6 seconds. Highlight one expression at a time. Do not scroll through whole files while speaking.
- Code below is excerpted from the current implementation. Ellipses in prose indicate omitted context, not code to add. Line ranges are recording guides and may move after future edits.
- Attribution: distinguish your integration and technical decisions from third-party assets. The game uses Three.js, cannon-es, and imported Quaternius combat animations; do not describe those imported clips as hand-keyframed by you.

---

## 1. Introduction - 0:00-0:15

### Voiceover

> "This is Brondon's Revenge, our 3D browser game built with Three.js. I'll show how movement, animation, environments and the camera work together, the decisions behind them, and the original music I composed for it."

### Picture and edit

- **0:00-0:05:** Ship interior or surveillance hub, moving through the space.
- **0:05-0:10:** Jungle bridge/river and a third-person character shot.
- **0:10-0:15:** Short combat shot, then the title: **BRONDON'S REVENGE / DEVELOPMENT VLOG**.
- Keep this a hook, not a full plot summary. No code yet.

## 2. Gameplay mechanics - 0:15-0:45

### Voiceover

> "The gameplay mixes traversal, stealth, puzzles and combat. Crouching and climbing change how you move through the ship, while the surveillance hub connects several puzzle rooms. The aim is to vary what the player does without making each activity feel disconnected. Movement also responds to state: a grounded jump is allowed, but climbing, sliding and crouching have their own rules."

### Picture and edit

- **0:15-0:23:** Crouch through a vent, then show ladder climbing.
- **0:23-0:31:** Approach the surveillance wall, enter a camera minigame, then cut to its interaction.
- **0:31-0:40:** Jump and land, followed by a slide and a brief combat exchange.
- **0:40-0:45:** Overlay the jump condition below over gameplay. Highlight `isOnGround`, then `!sliding`.
- On-screen label: **PLAYER STATE -> VALID ACTIONS**.

### Code to show

Source: [player.ts](./src/scripts/player/player.ts), lines **986-991**:

```ts
if (jumpQueued && !sliding && isOnGround && !crouching && !crouchForced) {
  playerBody.velocity.y = PHYSICS.jumpSpeed;
  isOnGround = false;
  intentionalJump = true;
}
jumpQueued = false;
```

For the hub's actual puzzle list, see [stageTwoLayout.ts](./src/scenes/level%201%20stage%202/stageTwoLayout.ts), lines **33-40**. This is a reference for choosing footage, not an additional code insert.

## 3. Character animations - 0:45-1:20

### Voiceover

> "The animation system reads the same player state as the controller, choosing clips for walking, sprinting, crouching, climbing and jumping. Instead of snapping between poses, actions fade out and in. Combat transitions use shorter blends for a sharper response. Imported combat clips are prepared for Brondon's rig. The slide pose is sampled from the gameplay slide timeline, so it tracks the actual movement."

### Picture and edit

- **0:45-0:55:** Fixed third-person framing: idle -> walk -> sprint -> crouch. Add small state labels as each changes.
- **0:55-1:00:** Ladder climb and jump/landing.
- **1:00-1:06:** Code insert: highlight `fadeOut(blend)` and `fadeIn(blend)`.
- **1:06-1:14:** Third-person punch or Bloomstick attack; keep the full body visible.
- **1:14-1:20:** Slide in normal speed, then briefly slow the footage and draw an arrow along the direction of travel.
- On-screen label: **PHYSICS MOVES THE PLAYER / ANIMATION SHOWS THE ACTION**.

### Code to show

Source: [characterManager.ts](./src/scripts/player/characterManager.ts), function `fadeTo`, lines **1208-1238**. Crop around these expressions; they are separated by other logic in the source:

```ts
else if (!sameAction) currentAction.fadeOut(blend);
```

```ts
next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
if (!immediate && !sameAction) next.fadeIn(blend);
next.play();
currentAction = next;
```

Optional replacement insert if you prefer discussing the slide: [characterManager.ts](./src/scripts/player/characterManager.ts), lines **1488-1497**, starting at `else if (playerState.sliding)`. Highlight `playerState.slideTime / SLIDE_TACKLE.duration`.

Rig/clip preparation reference: [combatAnimations.ts](./src/core/combatAnimations.ts), especially lines **75-119**. Mention integration and retargeting, not original authorship of the Quaternius clips.

## 4. Cutscenes - 1:20-1:50

### Voiceover

> "The facility arrival is an in-engine cutscene rather than a separate video. Brondon follows a curved path, and the path's tangent determines his facing direction. The camera blends from an establishing shot into a follow shot, then frames the photograph. Eased movement and a narrowing field of view help direct attention, before the scene restores normal control."

### Picture and edit

- **1:20-1:26:** Facility arrival opening, including Prime's resort remark if it fits visually. Duck dialogue under your narration.
- **1:26-1:34:** Brondon walking toward the hideout photograph. Draw a temporary curved path over the floor.
- **1:34-1:40:** Code insert below; highlight `lerpVectors`, then `lookAt`.
- **1:40-1:47:** Photograph reveal. Overlay **ESTABLISH -> FOLLOW -> REVEAL**.
- **1:47-1:50:** A few seconds after the cutscene, showing that control has returned.
- Film the full arrival once, then edit these moments together; do not spend the entire section waiting through it.

### Code to show

Source: [scene20.ts](./src/scenes/level%203/scene20.ts), lines **968-980**:

```ts
camera.position
  .lerpVectors(introOpeningCamera, introFollowCamera, follow)
  .lerp(introRevealCamera, reveal);
introLook.copy(introPosition).setY(1.3).lerp(picturePoint, reveal);
camera.fov = THREE.MathUtils.lerp(
  THREE.MathUtils.lerp(60, 52, follow), 48, reveal,
);
camera.lookAt(introLook);
```

Supporting references: the `CatmullRomCurve3` path at lines **852-859**, `getPointAt`/`getTangentAt` at **916-917**, and control restoration in `endIntro` at **879-892**.

## 5. Scene layout and environment - 1:50-2:25

### Voiceover

> "The surveillance hub gives the player a recognisable centre, with the camera wall, equipment and elevator acting as landmarks. The jungle uses paths and clearings to contrast with the enclosed ship. Its foliage combines repeated geometry with shader-driven wind. Each tuft sways more toward its tip, and shrinks away with distance. Instances are grouped into spatial cells, so visibility checks can skip chunks outside the view or range."

### Picture and edit

- **1:50-1:59:** Wide hub shot, followed by a short route from the camera wall toward the elevator. Outline those landmarks.
- **1:59-2:08:** Jungle landing clearing -> stone path -> bridge. Keep cuts moving in the same travel direction.
- **2:08-2:13:** Live close-up of moving grass/pine foliage.
- **2:13-2:19:** Shader code insert below. Highlight the shared wind uniform, then sway strength.
- **2:19-2:25:** Wide forest shot; add a simple grid overlay labelled **SPATIAL CELLS / VISIBILITY CULLING**. This is an explanatory overlay, not footage of a built-in debug view.

### Code to show

Source: [jungleFoliage.ts](./src/scripts/level-3/jungleFoliage.ts), the grass shader inside lines **73-87**. Show this as GLSL, not TypeScript:

```glsl
float foliageDistance = distance((modelMatrix * foliageOrigin).xz, cameraPosition.xz);
transformed *= 1.0 - smoothstep(24.0, 38.0, foliageDistance);
float grassSway = position.y * position.y;
transformed.x += sin(foliagePhase * 1.3 + position.x * 2.1) * 0.18 * grassSway;
transformed.z += cos(foliagePhase * 1.1 + position.y * 1.7) * 0.13 * grassSway;
```

Show `shader.uniforms.uCanopyWind = wind` just above it if space allows. Explain visually: **shared time + position offset -> wind**, **height squared -> more movement toward the tips**.

Additional references, not extra mandatory inserts:

- Hub landmark coordinates: [stageTwoLayout.ts](./src/scenes/level%201%20stage%202/stageTwoLayout.ts), lines **56-68**.
- Spatial partitioning: [jungleFoliage.ts](./src/scripts/level-3/jungleFoliage.ts), lines **208-245** (`cellSize = 24`, buckets, `InstancedMesh`).
- Distance/frustum test: [jungleFoliage.ts](./src/scripts/level-3/jungleFoliage.ts), lines **276-301**.
- This foliage helper is reused by [rescueSite.ts](./src/scripts/global/rescueSite.ts) and [finaleSite.ts](./src/scripts/level-3/finaleSite.ts).

Do not claim instancing makes the entire forest one draw call, or that visual culling removes gameplay collision.

## 6. Physics - 2:25-2:50

### Voiceover

> "Physics uses cannon-es with a fixed one-hundred-and-twentieth-of-a-second step, separate from rendering. The update loop also caps frame time and substeps, limiting catch-up work after a slow frame. Grounded movement follows the supporting surface, while airborne movement preserves vertical velocity for gravity and jumping. The goal is stable, predictable movement rather than tying physics directly to the frame rate."

### Picture and edit

- **2:25-2:33:** Walk up a slope or uneven jungle route, stop, then jump and land.
- **2:33-2:39:** Fixed-step code insert. Highlight the repeated `PHYSICS.fixedStep` arguments.
- **2:39-2:50:** Show another landing and walking against a solid obstacle. Add **FIXED PHYSICS STEP: 120 Hz**, then **RENDER RATE IS SEPARATE**.
- Do not imply 120 Hz physics guarantees 120 FPS or identical results at every frame rate.

### Code to show

Source: [scenePhysics.ts](./src/helpers/physics/scenePhysics.ts), lines **560-569**:

```ts
while (
  accumulator + 1e-10 >= PHYSICS.fixedStep &&
  steps < PHYSICS.maxSubSteps
) {
  player.beforePhysicsStep(PHYSICS.fixedStep);
  stepPhysicsWorld(world, PHYSICS.fixedStep);
  player.afterPhysicsStep();
  accumulator = Math.max(0, accumulator - PHYSICS.fixedStep);
  steps++;
}
```

Show `fixedStep: 1 / 120` from lines **4-8** as a small callout. Surface-aligned movement and preserved airborne vertical velocity are in [player.ts](./src/scripts/player/player.ts), lines **976-1000**.

## 7. Weapons menu - 2:50-3:20

### Voiceover

> "Weapon switching uses a radial menu: hold Tab, aim toward a weapon, and release to equip it. A central dead zone lets you keep the current weapon, and Escape cancels. The selection comes from the cursor's angle around the centre. Opening the wheel pauses gameplay, but keeps pointer lock, so mouse movement selects equipment without turning the camera. Unarmed also gives an explicit way to holster."

### Picture and edit

- **2:50-2:58:** Hold **Tab**, move between pistol, crowbar and Bloomstick, release to equip. Keep the menu readable.
- **2:58-3:04:** Reopen, return to the central dead zone, release; then briefly demonstrate Escape cancellation.
- **3:04-3:10:** Code insert. Draw an angle arc around the menu as `atan2` is highlighted.
- **3:10-3:20:** Equip and use a weapon, then choose **Unarmed**. Include a shot with an enemy visibly frozen while the wheel is open.
- On-screen labels: **HOLD -> AIM -> RELEASE**, then **CENTRE = KEEP CURRENT**.

### Code to show

Source: [weaponWheel.ts](./src/scripts/weapons/weaponWheel.ts), lines **26-36**, function `weaponWheelIndex`. Show the dead-zone branch and angle mapping:

```ts
Math.hypot(x, y) < DEAD_ZONE
```

```ts
const angle = (Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU;
return Math.round(angle / (TAU / count)) % count;
```

The dead-zone expression is part of a larger guard returning `-1`; do not present it as a standalone statement in a runnable example. Pause/pointer-lock handling is in the same file around lines **115-124**.

## 8. Camera viewing-angle decisions - 3:20-3:50

### Voiceover

> "First-person makes aiming and close interaction direct, while third-person reveals body animation and gives more spatial context. The follow camera isn't just a fixed offset: physics raycasts check the space between the player and camera. It pulls inward near walls and eases back out when clear. In very tight spaces it can fall back to first-person, avoiding a camera pushed through the scenery."

### Picture and edit

- **3:20-3:29:** Matched shots of the same movement/target in first-person and third-person. Label both, using **V** to demonstrate the actual toggle.
- **3:29-3:37:** Back toward a wall in third-person, then move out again. Keep the wall and character visible enough to show the distance change.
- **3:37-3:43:** Camera code insert below. Highlight `safeDistance`, then `Math.exp`.
- **3:43-3:50:** Tight corner/doorway demonstration; include automatic first-person fallback if you can reproduce it clearly.
- Optional overlay: a line from the player to the desired camera position, ending at a wall hit. Label it **COLLISION CHECK**, not a rendered laser.

### Code to show

Source: [camera.ts](./src/core/camera.ts), lines **112-123**:

```ts
const distance =
  reset || safeDistance <= previous!.distance
    ? safeDistance
    : THREE.MathUtils.lerp(
        previous!.distance,
        safeDistance,
        1 - Math.exp(-6 * Math.min(dt, 0.1)),
      );
```

Talking point: moving inward immediately prioritises clearance; smoothing the outward return avoids an abrupt pullback. The obstruction checks use a 3-by-3 set of ray origins around the camera near-plane footprint, not a full volumetric sphere cast. First-person fallback uses different enter/exit thresholds at lines **124-126** to reduce toggling near the boundary.

## 9. Original music - 3:50-4:35

**This is your dedicated 45-second section.** Replace the bracketed details with your actual composition process; the repository cannot establish your instruments, DAW or musical influences.

### Voiceover scaffold

> "I composed all the music myself, giving each part of the game its own identity. For [track or scene], I used [instrument or texture] to create [intended feeling]."

**Pause speaking for 5-6 seconds:** play that example over matching gameplay.

> "For [contrasting track or scene], I changed [specific musical choice] to make it feel [contrast]. Here's that difference."

**Pause speaking for another 5-6 seconds:** play the second example.

> "In the game, tracks are selected by scene or gameplay state, and many transitions crossfade. Opening the weapon wheel also muffles the background music, connecting the interface to the sound."

### Picture and edit

- **3:50-4:00:** Your actual DAW/session, piano roll, waveform or instrument recording. Use evidence of your own process, not stock music-production footage.
- **4:00-4:06:** First music example at a clear listening level, no voiceover.
- **4:06-4:18:** Return to the session or show the contrasting gameplay while explaining your choice.
- **4:18-4:24:** Second music example, no voiceover.
- **4:24-4:35:** Scene transition or a weapon-wheel open/close so the audience hears crossfading or muffling.
- Lower gameplay SFX during these examples. Avoid letting your narration compete with a loud mix.
- Keep this section about composition first; an implementation code insert is optional.

### Optional code reference

Source: [gameMusic.ts](./src/helpers/audio/gameMusic.ts):

- Scene-to-track mapping: lines **50-65**.
- Crossfade decision: lines **119-129**; ordinary transition duration is **0.9 seconds**, finale transitions use **3 seconds**.
- Weapon-wheel muffling: lines **183-185**, `setWeaponWheelOpen`.

Do not claim every music transition crossfades: some state changes intentionally switch immediately.

## 10. Conclusion - 4:35-4:50

### Voiceover

> "The biggest lesson was that these systems can't be designed in isolation: movement affects animation, geometry affects the camera, and music changes how an action feels. Bringing those pieces together is what gives Brondon's Revenge its identity. Thanks for watching."

### Picture and edit

- **4:35-4:42:** Three quick shots: movement/animation, jungle, combat.
- **4:42-4:47:** Your strongest clean wide shot, with your music lifted slightly.
- **4:47-4:50:** Title and contributor credits. Credit third-party assets/libraries where appropriate.

---

## Recording checklist

- [ ] Intro montage: interior, jungle and combat.
- [ ] Vent/crouch and ladder traversal.
- [ ] Surveillance hub plus one camera minigame.
- [ ] Idle/walk/sprint/crouch, jump/landing and slide in third-person.
- [ ] Full facility arrival, including the photograph and return to control.
- [ ] Jungle path/bridge, close-up wind and wide forest.
- [ ] Ground contact, slope and obstacle demonstrations.
- [ ] Weapon-wheel equip, central cancellation, Escape and Unarmed.
- [ ] Matched first/third-person shots and wall-clearance response.
- [ ] Two original music excerpts plus your composition-session footage.
- [ ] Code inserts captured at readable size, with paths available in captions.

## Final timing and accuracy pass

- Keep the finished video between **4:00 and 5:00**, aiming for **4:50**.
- If over time, shorten montage gaps and remove optional code inserts before cutting the music section.
- Show code while continuing the relevant explanation; do not add a separate spoken code-reading segment.
- Do not read punctuation, variable names or whole functions aloud. Explain the decision, then show its result.
- Label slowed footage, explanatory diagrams and developer-only access honestly.
- Rehearse the music section with the actual listening pauses; those 10-12 seconds count toward its 45-second budget.
- These references were checked against source, not a live gameplay recording. Confirm each staged shot in your current build before final narration.
