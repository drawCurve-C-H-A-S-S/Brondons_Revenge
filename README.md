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

## Background music

The shared [soundtrack controller](./src/helpers/audio/gameMusic.ts) owns music
across scene changes. The **BGM** volume control applies to every music cue,
including the pause menu and victory track.

| Area or event | Track |
| --- | --- |
| Scene 1 opening | Loading |
| Prison prologue | Emotional |
| Living quarters | Living quarters |
| Stage One, first half | Stealth1 |
| Stage One, second half | Stealth1 2 |
| Stage One, caught or hangar alarm | Stealth1 3 |
| Level 2 flight and scrambler phases | DonRevLevel2 |
| After destroying the red scrambler, including the crash handoff | DonRevLevel2Boss |
| **M** pause menu and its submenus | Menu |
| Boss defeated | Victory boss 1, once without looping |
| Final boss introduction and transformations | Loading |
| Playable final boss duel | Three-second crossfade into DonRevBGM1 |
| Final credits | Level 2 |

The Stage One music trigger spans the hangar at the center of the **second cargo
row**, including the floor and container roofs. Crossing it latches the second
track for that attempt: walking back does not undo it, and hints need not be
enabled. Being caught selects the alert track immediately; retrying starts a
fresh attempt. The alert song supplies the siren, so there is no additional
synthesized siren; short interaction and combat effects remain.

Opening **M** suspends gameplay audio and plays Menu without restarting it when
switching submenus. Closing the menu resumes the previous music position.
Victory music overrides the background and survives ordinary scene transitions;
when it finishes, the current area's background resumes. The credits cue takes
over when the final credits begin. Weapon-wheel pauses do not start Menu.

Existing ship/hangar and jungle music remain in their original areas. The final
battle track continues through the ground duel, planet rupture, space duel and
finisher without restarting between phases.
Music uses decoded Web Audio buffers rather than streaming-element loop restarts.
Loop padding is trimmed and the seam is blended over **0.65 seconds**. Ordinary
soundtrack changes use a **0.9-second equal-power crossfade**; the final boss
entrance keeps its **3-second** transition. Outgoing music stays audible while
the next track loads, and rapid cue changes retain the music already in the mix.

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
  and a unique expedition poster. Recover the **purple teleport crystal from
  Brendan's chest** and **scanner goggles from Branden's chest** before leaving.
  **N** toggles the goggles; **Q** places a purple marker and **T** returns to it.
  **Hold Tab** selects weapons, not teleport destinations.
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

## Level 1 Stage Two: surveillance route

Stage One's airlock now leads to the service passage, storeroom, vent maze and
surveillance room, then the service elevator to **Bay 13**.

- The two distracted patrol robots exchange spatial **beep-boop sounds**, not
  speech or dialogue bubbles. Brondon slips through the storeroom's sliding door.
  Its stocked metal shelves match the Stage One storage interior.
- Open the crew-style tool chest with **E**, select the **crowbar with Tab**, and
  swing at the crate blocking the ladder. It breaks on one crowbar hit and its
  collider is removed. The noise triggers the patrol response cutscene.
  **E** mounts the ladder; **hold Space** to climb quickly before the bots arrive.
- The vent maze becomes the fullscreen map, with the live vent camera in a small
  inset. The easy route is **RIGHT across the top corridor, then DOWN the right
  edge to CAMERA ROOM**. The dotted line shows it. Wait for moving sensors to
  turn green; blue pads are checkpoints. Detection returns you to the last pad.
- Drop behind the single surveillance guard, stay crouched and press **E** from
  close behind for a silent takedown. A failed or noisy attack is fatal, with a
  local **R** checkpoint retry.
- The surveillance room uses a prologue-style monitor bank, pale console
  worktops, server racks and auxiliary terminals. Leave your home marker here
  with **Q**, look at a live feed, and press **E** to visit the cargo hold, target
  range or sealed equipment archive. **T** returns to surveillance.
  Placing **Q** elsewhere replaces that marker and loses the safe return link;
  **R** can restart a stranded visit at the surveillance checkpoint.
- The archive has no doors, one inward-facing lightsaber footlocker and a
  maintenance computer. Read its file using the reused screen-zoom interaction.
  It reveals the goggles-only keypad beside the surveillance camera wall and
  code **7314**. Return with **T**, wear the goggles with **N**, inspect the
  keypad with **E**, then enter the code.
- The Bay 14 selector is broken. Choose **Bay 13** for the flickering-light
  descent and heavy stomps, followed by the automatic walk through the elevator
  door into the existing Bay Warden introduction. Health, shield and inventory
  carry across.
- Scenes **2, 3, 4, 7, 8, 9, 10, 11 and 12** remain as source files, but are no
  longer imported, preloaded, routed or offered in the active developer menu.
  The camera rooms use lightweight crew chests rather than the old model chest.

Developer Mode includes **Level 1 stage 2 - Surveillance route** and the archive
and camera-room previews. In development, `?stage2-infiltration` starts Stage Two
with the earlier cabin equipment available, but leaves the crowbar and lightsaber
to be recovered normally.

## Scene 13: Bay Warden

- The service-elevator exit and stair-entry cinematic lead into a **2.6-second comic versus screen**:
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

## Scene 21: Final boss

Stage One's first Deck One entry and the initial final-boss entry use cinematic
loading screens with a randomly selected destination screenshot and gameplay tip.
They remain visible for at least **three seconds**, and longer when assets are
still loading. Returning to storage, retrying a boss checkpoint and all other
scene transitions retain their existing seamless handoffs. Entering Scenes
13, 14, 15 and 16 shows the same short **CHECKPOINT SAVED** banner as Stage One.

Scene 19's facility exit leads into the Sudoers 5 finale. The taller summit room
has cold, desaturated ceiling spotlights and synchronized student dialogue. The roof
blows clear, the students enter their mech one at a time, and the shuttle recalls
from its Scene 17 jungle parking spot to morph into Prime Frame. A comic VS
screen introduces the fight; there are no generated platforms under the mechs.
After the transformations, dusk deepens into a moonlit, starry nighttime rooftop.

Use **A / D** to move and **J** to chain a downward cut, side cut and heavy downward
finish. Damage follows the animated blade sweep; luminous cuts remain on damaged
armor for **1.65 seconds** before fading. **F** sheaths the sword, draws the
back-mounted rifle and fires a two-handed salvo. **Hold R** for a draining shield
or timed parry, and **Space** for a dodge boost. **E** charges **Last Light**, then
releases a flying blade flash; it starts ready and recharges in **18 seconds** of
combat time. **W / S** control altitude in space. Shielded hits are fully absorbed,
including the hit that breaks the shield. Blocking recoils melee attackers and
deflects projectiles; a timed parry reflects them toward Sudoers 5.

Sudoers 5 jumps forward into its thrust, uses a reverse diagonal cut, and leaps
backward before charging its sword-tip beam. The jumps move the actual combat
body in both rooftop and orbital fights. Recovery reminders, adaptive exploration
hints and introductory control cards are disabled during the finale; QTE prompts,
attack tells and resource warnings remain. Special-move close-ups return to the
normal camera **at least 0.55 seconds before firing**. Both fighters are protected
from unrelated attacks during the introductory close-up; dodge or guard when
gameplay resumes. Release R to recharge the shield.

Before the orbital phase, the enemy poses, jumps back, raises both hands, forms
the planet breaker, launches it skyward and commands its descent. The camera
follows the meteor into Earth, then shows the explosion with a large **BOOM!**
using the same starburst, halftone and ink artwork as other comic impact words.

The final QTE runs on a continuous cinematic timeline, regardless of successful
or missed inputs. Time the tap prompts as the closing ring meets the target,
**mash D six times** to win the blade lock, and **hold E continuously** to charge
the sword. Each prompt earns **one, two or three stars**. Up to two misses are recoverable;
**the third wrong or late command** blends from the current shot into Brondon's
death and checkpoint retry. A successful run ends with a skyward sword charge,
forward rush, disappearance, reappearance behind the enemy, a quiet pause and a
delayed storm of slashes. Donus's return brings back the actual Scene 1 mothership
and Prime Frame's authored dance. Centered credits run in **28 seconds**, retaining
the image-only dancing Brondon copies. A visible **hold Enter to skip** control
skips the boss introduction; the same control skips the ending dialogue in
Scenes 13 and 16 without losing their unlocks or scene handoff. Scene 1 ends
directly on **Play / Don't Play**, with no opening credits roll.

For local playtesting, open the pause menu, select **Developer Mode**, and click
**Unlock**. No password is required.

## Earth visuals

The shared [Earth renderer](./src/scripts/earthTexture.ts), brought over from the
`earth` branch, generates **2048 x 1024** terrain, roughness and cloud maps.
Generated pixels are cached between scenes, with separately owned texture handles
so disposing the previous scene cannot invalidate the next planet.
The prologue, hangar launch, Level 2 flight and planetary descent, and final boss
all use the same terrain, cloud layer and blue atmosphere glow. Surface rotation
and cloud drift pause with gameplay. The finale keeps its planet-breaker cracks,
textured fragments and destruction timing; clouds and atmosphere fade with the
planet instead of remaining as an intact globe after the rupture.

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
      level 3/              Scenes 17–19 and final boss scene 21
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

## Final chapter: Sudoers 5

The restored route is scene 16 crash landing → scene 17 jungle approach → scene
18 facility encounter → scene 19 summit return. Crossing the facility door in
scene 19 starts scene 21 on the same rescue-site world, above the facility roof.
The reveal and each student's close-up share one dialogue timeline. After the
roof shatters, the five students ascend one at a time and merge into the enemy's
chest through subdued crimson beams and a dark energy aura. The actual shuttle lifts off from its jungle
parking spot, flies to Brondon, disassembles, and morphs into Prime Frame. A comic
VS introduction leads into the duel on the facility's exposed top floor; there
are no generated mech platforms.

The combat controls and timing are shared by the summit and orbital phases.
Hand-attached sword IK, sampled rig trajectories and armor engravings agree on
contact; the authored sword swing and native locomotion are retained.
The rifle uses the right hand on the trigger and the left hand on the foregrip.
Sudoers 5 has separate thrust, reverse-cut and sword-beam animations. The planet
breaker's upward launch and accelerating descent share the camera's timeline.
The detonation removes Earth and the terrestrial environment, leaving rocky
debris in orbit. QTE input grades timing without starting, stopping or speeding
up a shot; only the third miss interrupts the cinematic with death. The delayed
teleport execution is required to defeat Sudoers 5. HUD panels, recharge
indicators and controls use the game's shared comic-paper panels, ink outlines,
hard shadows and resource colors; the VS and game-over layouts are preserved. Hold **Enter** during the
reveal and transformations to skip ahead to the VS introduction.
Victory credits are centered over differently oriented dancing-Brondon sprites
rendered from the character model; these are images, not cloned players or physics.
The epilogue also flies in the shared opening mothership and plays Prime Frame's
native `Dance_Loop`; the credit timeline and scrolling share one duration.

## Tech Stack

- **Three.js** -- 3D rendering
- **TypeScript** -- Type safety
- **Vite** -- Dev server and bundler
