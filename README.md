# Brondon's Revenge

A 3D browser game built with Three.js for the COMS3006A CGV project.

## Setup

### Install dependencies

```bash
npm install
```

### Development

Run the dev server with hot-reload:

```bash
npm run dev
```

### Production build

Build the project to the `dist/` folder:

```bash
npm run build
```

### Serve the production build

Serve the built project locally (this is how markers will run it):

```bash
npx serve dist
```

Always test the production build locally before deploying. The LAMP server serves static files only -- it will not run your build tools.

## Getting Started

- **[STARTHERE.md](./STARTHERE.md)** -- how the project is structured, how to create scenes, wire up managers, and what to watch out for.
- **[MANAGERS.md](./MANAGERS.md)** -- reference for every manager in `src/helpers/` (animation, audio, physics, triggers, scene) with usage examples.

## On-foot HUD

The small centre dot is shared across on-foot gameplay, rather than belonging to
one scene. A gun aim crosshair replaces it when active. It is hidden during
cutscenes, menus and teleport transfers, and is not shown in Level 2.

## Comic combat callouts

Enemy actions now produce short, world-anchored comic words rather than a
full-screen overlay:

- **BAM! / PING! / KRAK!** mark damaging hits; lightsaber and laser hits use **ZAP!**.
- **BOOM!** marks exploding interceptors, eye drones, scramblers and ship components.
- **CLANK!** marks robot shutdowns and takedowns.
- Small, translucent **PEW!** callouts appear beside enemy laser muzzles.

The billboard words follow moving enemies on hits/shots, stay at the detonation
point on deaths, and retain world perspective, parallax and depth occlusion.
Flight explosion words inherit the world's scrolling velocity to stay with the blast.
Comic bursts use thick ink outlines, halftone shading and brief pop/fade motion.
Shot/hit callouts are throttled per enemy, pooled and capped to avoid clutter.
Menus freeze their lifetime, scene changes clear them, and reduced-motion
preferences disable the pop and drift.

## Slide tackle

Press **C while moving forward with W** to perform a **1.4-second slide tackle**.
It works at normal forward speed or while sprinting with **Shift**. The grounded
slide carries momentum along the starting heading, brakes, and smoothly returns
to walking/running; releasing W lets the recovery come to a stop.

- The actual character skeleton drives the movement: lowered and rotated hips,
  articulated spine/head, extended leading leg, tucked trailing knee, a bracing
  hand, toe-up leading boot, and a planted get-up. Physics owns forward travel.
- First-person keeps your chosen view with a smoothly lowered camera; **V**
  shows the full animation in third-person. Weapons stay tucked during the slide.
- C still toggles crouch when stationary or moving sideways/backward. On touch,
  tap **CROUCH while moving forward** to slide.
- Slides cannot start in the air, vents, zero-G, on ladders, while handling cargo,
  or in the side-scrolling platformer. Jump/action inputs cannot interrupt or
  queue through the slide. Walls, lost ground, menus and scripted traversal
  cancel it safely; holding C never retriggers it.

## Living quarters opening

After the prison prologue, press **E** to let Prime teleport Brondon to his cabin.
The arrival cinematic establishes his room and the crew passage before handing
control back to the player. Hold **Enter** to skip the arrival once the room is ready.

- The passage has **four cabins on each side**: Brondon, Branden and Brendan are
  unlocked; the five student cabins are locked.
- Look at a nearby wall-mounted nameplate to display the room name automatically
  as comic-style subtext at the bottom of the screen. Nameplates show only the
  owner's name, with **no E prompt or key press**. The top-left HUD shows only the
  current room or area in a yellow comic caption with bold lettering and an
  outlined, offset-shadow panel.
- Doors, chests and devices keep the **comic-styled E interaction prompts**.
  Inspection information temporarily hides interaction prompts and nameplate
  captions; they return when the information message clears.
  Interacting with a door is separate: unlocked doors play an automatic
  walk-through cinematic in either direction; locked doors report their occupant.
- Recover the **pistol from Brondon's chest** and the **blue-LED teleportation
  device from his desk**. The pistol cannot be equipped before recovery.
  The teleporter's outbound destination link is blocked for now.
- Every cabin shares a bed, correctly scaled desk/chair assets, a local computer
  with a blue desktop, file window, icons and taskbar,
  and a unique expedition poster. Branden and Brendan have interactive, empty
  chests ready for future contents.
- Open **M > Ship Map** for a growing map of the sections you have reached.
  Living quarters are charted on arrival; entering Deck One adds the stealth
  passage, storage room and cargo hangar without removing the cabins. The two
  layouts join at the forward bulkhead, with a correctly aligned player marker.
  Locked cabins remain opaque; their furnishings are never exposed.
- **Left-drag** rotates the map, **scroll** zooms toward the cursor and
  **right-drag** pans. On touch, drag to rotate and use two fingers to pan/pinch.
  Arrow keys pan, **+ / -** zoom, **F / Locate** centers on Brondon and
  **Home / Reset view** fits the charted ship. Your view is retained when closing
  and reopening the map. Click a room or its numbered marker for its name.
  Deck filters appear only when multiple decks are charted; the room dropdown,
  connected-room button list and separate zoom buttons have been removed.
- In **Branden's room**, use his computer to pan in to the real screen.
  Move its on-screen cursor and click the single **save us** text file, or press
  **Enter** to open it. Branden's local bot left a four-digit maintenance password;
  Prime reads it out. **E**, **Esc**, or **Step back** returns to exploration.
- Use the **number panel beside the forward bulkhead** to zoom in. Only Brondon's
  right hand is shown, baked from the model's **Interact** pose. Click the digits
  or use the number keys, then **OK / Enter**; **Backspace** erases and **CLR**
  clears. Incorrect codes leave the door locked and display an error.
- The correct code opens the bulkhead into the **opposite end of the Deck One
  patrol passage**. The transition prepares models and shaders before switching
  areas; failed loads keep the current area available with retry/cancel controls.
  The passage bulkhead can also return to the living quarters.
- The eye drone stays **completely stationary until Brondon reaches the passage
  midpoint**, then begins patrolling. Open the storage door from outside with
  **E**, hide inside and close it as the eye passes, then slip out behind it.
  Peeking and **B** quick-hide remain available from storage. The hangar
  checkpoint and the rest of Stage One continue as before.
- Map discovery survives scene changes, returning to living quarters and deaths
  during the current playthrough. Restarting the prison prologue or refreshing
  the page clears it. Later ship sections are added when reached.
  Existing stealth and later levels remain accessible through Developer Mode.
  The prologue previews the actual Deck One stealth hangar and its patrols.

The area is one connected scene in [living quarters](./src/scenes/living%20quarters/).
Cabin furnishings are created on demand while the door cinematic plays, with
asset caching and shader preparation before crossing the threshold. Room visits,
chest openings, the bot message, the unlocked bulkhead and recovered equipment
persist across area visits in the current play session. Failed cabin loads show
retry/cancel controls instead of allowing the player into an unfinished room.

The student cabins belong to **Caleb, Husain, Andre', Sibusiso and Sohrab**.
Their roster is maintained in [layout.ts](./src/scenes/living%20quarters/layout.ts). In development,
`?living-quarters` opens the area directly; the scene selector also has a
**Living quarters - crew cabins** entry.

## Scene 13: Bay Warden

- The stair-entry cinematic leads into a **2.6-second comic versus screen**:
  Brondon's portrait above, the Bay Warden below, with animated speed lines,
  character names and the same punching **VS** badge used in Scene 14.
  The boss stays dormant and controls stay locked until the matchup finishes.
  Checkpoint retries skip the introduction; returning after victory does not replay it.
- Each of the four cover pillars has a small rear-facing service recess.
  These hide **exactly two blue shield crystals and two green health boxes**.
  Walk up to a recess during combat to collect its supply automatically:
  shields restore up to **50 shield**, health boxes restore up to **100 health**.
  Supplies are not consumed when the corresponding bar is already full.
- Each cache can be used once per fight attempt. They reset with the boss on a
  checkpoint retry, and remain collectable if their pillar is destroyed.
  Pillars keep their original collision, laser-cover and shattering behavior.
  The separate health pack awarded after victory is unchanged.

## Level 2 matchup, targeting and firing

- Scene 15 preserves Scene 14's launch position, heading, camera and speed,
  smoothly settling into the chase camera while the shuttle flies **alone for
  two seconds**. The capital ship then **fades in from the distance over 1.25
  seconds**, before the matchup appears.
- The **4.6-second ship-versus-blockade cinematic** uses the
  actual escape shuttle and capital ship, with a six-interceptor formation
  representing the enemy wing. Animated arrivals, camera dollies, blue/red
  space panels, ship labels and a punching **VS** badge introduce the matchup.
- Flight, damage and firing wait until the intro ends. **Enter / Skip intro**
  starts combat immediately; skipping does not fire a shot or activate a shield.
  Pause/focus loss freezes the intro, and input is cleared before combat.
  Portrait screens stack the matchup panels; reduced-motion preferences remove
  the camera/model motion. Sortie retries and direct Scrambler starts skip it.

- The opening Scene 15 interceptors have an invisible **8-unit shot-hit radius**
  around their hulls, making near misses more forgiving without enlarging their
  ship-collision radius. Later scrambler escorts retain their original targets.
- **Click or hold LMB** to fire; the same applies to quick taps on mobile FIRE.
  A short press is buffered until the next valid shot, including the remainder
  of the existing **0.11-second cooldown**. Releasing before the next rendered
  frame no longer loses the shot. Normal flight retains the click's aim point;
  the top-down section still fires upward.
- Pausing, focus loss, restarting and changing flight phases clear pending
  presses, so input cannot carry an unintended shot into the next section.

## Project Structure

```
project-root/
  package.json
  vite.config.js
  tsconfig.json
  README.md                 Setup and deployment instructions
  STARTHERE.md              How to build scenes and use managers
  MANAGERS.md               Reference for all helper managers
  src/
    index.html              Entry point
    main.ts                 Bootstrap -- creates renderer, camera, controls, runs the loop
    core/
      renderer.ts           WebGLRenderer setup
      camera.ts             PerspectiveCamera setup
      controls.ts           OrbitControls (swap for FP controls later)
      loader.ts             GLTF/GLB model and texture loader
    scenes/
      scene1.ts             Intro cutscene
      prologue/             Prison awakening and security/stealth previews
      living quarters/      Shared habitat scene with lazy cabin interiors
      level 1/              Scenes 2–14
      level 2/              Scenes 15, 15.5 (scene15-5.ts), and 16
      level 3/              Scenes 17–19
    scripts/
      player.ts             Example player controller class
    helpers/                Reusable managers (see MANAGERS.md)
      animation/            AnimationManager, CutsceneManager, SplineEditor
      audio/                AudioManager
      physics/              Cannon-es adapter and public API
      scene/                SceneManager, SceneAssets, sceneSchema
      triggers/             TriggerManager
      scripts/              ScriptManager
    assets/
      models/               .glb / .obj files
      textures/             Texture maps
      sounds/               Audio files
      fonts/                Web fonts
    styles/
      main.css              UI styles
    utils/
      constants.ts          Config values
  dist/                     Production build output (auto-generated)
```

Important:
- All paths must be relative (no leading `/`)
- Asset filenames must match case exactly (Linux server)
- Use lowercase filenames with hyphens, no spaces

## Tech Stack

- **Three.js** -- 3D rendering
- **TypeScript** -- Type safety
- **Vite** -- Dev server and bundler
