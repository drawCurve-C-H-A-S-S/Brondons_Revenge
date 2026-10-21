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

### Main character model

Brondon uses `src/assets/models/Don.glb` from the `brondon-model` branch
(commit `97050dc`). The player loader keeps the existing 1.83 m gameplay height.
His authored materials and animations are preserved. The branch's two-tone cel
shader uses the emissive colour (or base colour), with half-bright shadows and
flat-colour face skin and eye whites. It is applied through the standard skinned
material pipeline so silhouette and teleport/melt effects remain compatible.
The `brondon-model` goggles update (`abdba2b`) disables cel shading while night
vision is active, using a flat 30% base brightness for the ASCII pass. Removing
the goggles restores cel shading. Directional ASCII edges use corrected
horizontal/vertical glyphs and replace the cell against a black background.
Combat and slide clips
are retargeted to his bind pose; after replacing this model, regenerate them with
`node scripts/importQuaterniusAnimations.mjs --brondon`.

### Other character model

The other character uses the original, unsmoothed `src/assets/models/Subject.glb`,
with its six authored mesh primitives and existing skeleton. Do not regenerate
the smoothing shell; the optional local smoothing script is not part of the
asset pipeline.

### Development dependency cache

The live Vite server uses `src/node_modules/.vite-game`; Node test workers use
separate `src/node_modules/.vite-tests/<pid>` caches so SSR tests cannot invalidate
the browser's optimized dependencies. All runtime dependency entry points are
pre-bundled, including the finale's bloom/composer/environment modules, with
late dependency discovery disabled. Add new bare imports to `optimizeDeps.include`
in `vite.config.js`. After changing dependencies or optimizer configuration,
reload an already-open game tab to discard stale module URLs.

### Doorway landing surfaces

Sliding portals keep an invisible threshold collider spanning the seam, but
only render the landing outside the room boundary. Rooms with their own
vestibule, elevator or exterior deck pass `landingFloor: false`, leaving that
deck as the sole visible surface. Keep adjacent floor slabs edge-to-edge;
do not stack coplanar decking or use global depth bias to hide overlaps.

## Getting Started

- **[STARTHERE.md](./STARTHERE.md)** -- how the project is structured, how to create scenes, wire up managers, and what to watch out for.
- **[MANAGERS.md](./MANAGERS.md)** -- reference for every manager in `src/helpers/` (animation, audio, physics, triggers, scene) with usage examples.

## Keyboard and controller input

Keyboard and mouse are the initial default. Connecting a supported two-stick
controller automatically enables controller input once the browser detects it.
Switch / NES-themed and PlayStation devices use their detected button labels;
other standard-mapped devices use Xbox labels. You can change the profile under
**M > Controls > Controller**. Manual profile choices are remembered for each
device during this play session. Selecting Keyboard & Mouse keeps that mode
until you select Controller or reconnect the controller. Nonstandard devices
still require calibration before their controls can be enabled.
The two Controls tabs select the input and show the matching bindings.
The menu is available during the opening as well as gameplay.
Scene 1 suppresses automatic controller notices and gameplay control popups;
controller setup remains available through the pause menu.
**Sound** is available from the pause menu in every scene, including Scene 1.
**Display** includes a **Bloom** strength slider, **Hide HUD**, **Show FPS** and
**Perf timers**. Bloom strength and style are remembered between visits.
Press **Backslash (\\)** outside a text field to cycle bloom off, bright and soft.
With **Show FPS** enabled, **Perf timers** adds CPU rendering time and GPU time
when the browser supports GPU timer queries.
**View Ship Map** appears only in ship-interior scenes; the opening, flight,
planet and finale scenes do not expose it. The normal minimap and its comic
frame are both circular.
Weapon and scene control cards dismiss automatically after **6 seconds**
(flight controls after **4 seconds**), or immediately with **H**.
Press **1** to toggle a solid-black player silhouette for trailer capture.
The setting persists across scene changes, preserves animation and teleport
fades, and leaves equipped weapons and other characters unchanged.

Browsers may not expose a USB controller until its first button press. Use a
current Chrome, Edge or Firefox browser on HTTPS or localhost. Standard-mapped
pads use the browser's physical button positions, with the selected family's
printed names. Gameplay uses equivalent positions across families; menus use
the conventional confirm/back buttons for each family.
For adapters that reverse the face buttons, use **Swap A/B** or
**Swap Cross/Circle** under Controller.

**Calibrate game controls** is available only inside the **Controller** tab,
never under Keyboard & Mouse. Calibration asks for only the **14 buttons used
by the game**: four face buttons, both shoulders and triggers, four D-pad
directions, and the menu/skip buttons. Both sticks' directions are calibrated
too, for **18 steps total**. Stick clicks, Home/Guide/PS, Capture/Share/touchpad
press and unused extra buttons are not requested.
Follow the labels for your chosen family; release every button and center both
sticks before starting. Axis-based triggers and D-pads are supported.
Calibration and face-button swaps are retained separately for each device and
controller family for this page session, including reconnects.

| On-foot action | Switch | Xbox | PlayStation |
| --- | --- | --- | --- |
| Move / look (yaw and pitch) | Left / right stick | Left / right stick | Left / right stick |
| Jump | B | A | Cross |
| Toggle crouch / sprinting forward tackle | Y | X | Square |
| Sprint | Hold ZL | Hold LT | Hold L2 |
| Shoot / swing / slash | A | B | Circle |
| Interact / use / collect | R | RB | R1 |
| Weapon wheel (right stick selects; release to equip) | Hold L | Hold LB | Hold L1 |
| Cancel weapon selection / menu back | B | B | Circle |
| Menu confirm | A | A | Cross |
| Place teleport anchor / return to it | D-pad Down / Up | D-pad Down / Up | D-pad Down / Up |
| Dance (keyboard 9) | D-pad Right | D-pad Right | D-pad Right |
| Scanner goggles | ZR | RT | R2 |
| Change camera view | X | Y | Triangle |
| Pause menu | + | Menu | Options |
| Skip an available cinematic | Hold - | Hold View | Hold Create / Share |
| Retry an on-foot checkpoint / hide at the storage door | D-pad Left | D-pad Left | D-pad Left |

Sticks have a radial **18% dead zone** and proportional movement speed. Controller
look does not require mouse pointer lock. Keyboard/mouse gameplay input is
inactive in controller mode, but mouse and keyboard can still operate menus.
Movement, look and held sprint are polled continuously. Releasing L / LB / L1 resumes
movement **immediately, even if the left stick never returns to center**, and
holding ZL / LT / L2 through weapon selection resumes sprinting. Menus/cinematics freeze
gameplay, then resume the current held movement. One-shot actions still require
a fresh press, so selecting a menu item does not also shoot, jump or interact.
Focus loss pauses input until the page is focused again. Unplugging
the active controller releases all inputs, cancels the wheel without equipping,
and restores keyboard/mouse; click the world to recapture the mouse if needed.

In controller mode, deaths in the stealth and surveillance stages restart their
checkpoint automatically after the death presentation; the final boss retries
its last checkpoint after the defeat cinematic. Existing automatic combat and
flight retries remain active. The hangar escape always restarts in **Scene 14**
with full health, skipping the lift arrival and introductory reveal.
Brondon's shuttle destruction uses the same volumetric fire shader in Scene 14
and every Level 2 flight phase, with the flight blast staying at the destruction
point while the defeat presentation plays.
Shots taken inside an eye drone's view remain blocked by armour, but no longer
instantly kill and disable Brondon; patrol detection handles the ensuing danger.
Pistol hits from outside its current view, including side angles, can disable it;
the hit rule uses the same vision, range and cover checks as detection.

The opening **PLAY** screen and pause submenus show a highlighted selection:
use the left stick or D-pad to navigate and the family's confirm/back buttons.
PLAY is selected automatically when it appears. Sound sliders are adjusted
left/right; checkboxes use the confirm button. Keyboard/mouse menu use still works.
M and Escape remain keyboard menu fallbacks in controller mode.

The following combat examples use Switch labels. Xbox and PlayStation use the
equivalent positions from the table above, and in-game prompts change to match.
In **flight**, use left stick to steer, right stick to aim, hold A to fire,
B to evade, R to activate a collected shield, X to change view and + for the menu.
The arcade flight phases retain their directional dodges with left stick + B.
During the **hangar escape QTE**, the displayed controls are A (shoot),
X (crowbar), B (dodge), Y (saber spin), and R (launch).

The **final boss** uses left stick for movement and space altitude, direction + A
for sword attacks, X for the rifle salvo, hold ZL for shield/parry, B for dodge boost,
and R for Last Light (the existing 18-second recharge). L stows/recalls the fixed
weapons; A chains jab, cross and hook while unarmed. Y performs a grounded slide.
There is no inventory wheel. Hold - to skip the intro;
D-pad Left retries after defeat. The final execution is an uninterrupted cinematic:
no controller taps, mash prompts or held inputs are required. Pause still works.

## Background music

The shared [soundtrack controller](./src/helpers/audio/gameMusic.ts) owns music
across scene changes. The **BGM** volume control applies to every music cue,
including the pause menu.

| Area or event | Track |
| --- | --- |
| Scene 1 opening | Loading |
| Prison prologue | Emotional, decoded before the scene begins and started at full gain |
| Prime breaks the prison chains | BrokenChainsBGm, switches at the chain-break frame |
| Living quarters | Living quarters |
| Stage One, first half | Stealth1 |
| Stage One, second half | Stealth1 2 |
| Stage One, caught or hangar alarm | Stealth1 3 |
| Level 2 flight and scrambler phases | DonRevLevel2 |
| After destroying the red scrambler, including the crash handoff | DonRevLevel2Boss |
| Planet jungle, bridge and secret waterfall | Planetbfm |
| **M** pause menu and its submenus | Menu |
| Boss defeated | Existing area music continues without a victory-song override |
| Final boss introduction and transformations | Loading |
| Playable final boss duel | Three-second crossfade into DonRevBGM1 |
| Final credits | Level 2 |

The Stage One music trigger spans the hangar at the center of the **second cargo
row**, including the floor and container roofs. Crossing it latches the second
track for that attempt: walking back does not undo it, and hints need not be
enabled. Being caught selects the preloaded alert track immediately at full
gain, without a fade-in; retrying starts a
fresh attempt. The alert song supplies the siren, so there is no additional
synthesized siren; short interaction and combat effects remain.

Opening **M** suspends gameplay audio and plays Menu without restarting it when
switching submenus. Closing the menu resumes the previous music position.
Boss victories never pause or restart the current soundtrack. The credits cue
takes over when the final credits begin. Opening the weapon wheel keeps the
current BGM playing at 55% of its normal level, with a smoothly applied 850 Hz
low-pass filter, instead of pausing it or starting Menu. Closing the wheel restores
the original sound without restarting or seeking the track. Gameplay and sound
effects still pause; browsers without Web Audio retain the reduced-volume effect.

Existing ship/hangar music remains in its original areas. Planetbfm replaces
DonRevJungleLoop on the planet. Skipping the prison release selects Broken Chains
when the prologue hands back control. The final
battle track continues through the ground duel, planet rupture, space duel and
finisher without restarting between phases.
Music uses decoded Web Audio buffers rather than streaming-element loop restarts.
Loop padding is trimmed and the seam is blended over **0.65 seconds**. Ordinary
soundtrack changes use a **0.9-second equal-power crossfade**; the final boss
entrance keeps its **3-second** transition. Outgoing music stays audible while
the next track loads, and rapid cue changes retain the music already in the mix.

## Loading and caching

The opening requests **Loading.m4a first**, before model loading. The mothership's
compatible static surfaces and edge lines are batched, and its first GPU render
is prepared before the opening camera starts. Character animation preparation
and later-chapter downloads no longer compete with that visible opening.

Pressing **PLAY** immediately opens a randomized, six-second screenshot slideshow
with chapter-specific hints. It includes the prologue, living quarters, Level 1
stealth/minigames/boss/escape, every Level 2 phase, the Level 3 jungle, secret
waterfall, facility and final boss. Screenshots are captured from the game's
actual scenes. Loading artwork for the stealth patrol, cargo, range, interceptors,
green/red scramblers, exposed reactor, jungle, facility and both finale views was
refreshed from the 14 October screenshots. The exposed reactor has its own image,
separate from the capital ship's shield phase.
The progress bar counts completed download/preparation jobs, not
an estimated timer; the prison's cutscenes and first-render shaders are prepared
before the game starts. Failed preparation stays on the loading screen with
**TRY AGAIN**, retaining successfully cached files.

All runtime models, their external texture/buffer dependencies, music, surveillance
footage, screenshots and chapter code are loaded up front. Unused authoring assets
and obsolete scenes are excluded. Planet texture generation is incremental so
the slideshow can continue during that CPU-heavy work.

Compressed assets stay cached for the play session. Production builds also reuse
a versioned browser cache across visits when storage is available; development
avoids persistent caching to keep edited assets fresh. An unavailable browser
cache is explicitly reported, and the current session still uses its in-memory
cache. Models share decoded templates with independently disposable scene copies.
Decoded music has a **128 MiB** budget (**64 MiB** on devices reporting at most
4 GiB); evicted tracks retain their compressed data and prepare again before their
chapter. Low-memory/touch devices decode fewer distant models up front.

Whole levels are not kept alive simultaneously. Chapter transitions cover scene
construction, texture uploads and shader warm-up, preserving memory and avoiding
visible first-render stalls. Caching removes download waits, not every possible
rendering or device-related frame drop. Warm-up includes the persistent character,
combat billboards, shadows, minimap/post-processing and fog/non-fog variants before
the loading cover is removed. The landing film prepares its ground-world lighting;
the finale uses one memoized render warm-up with its persistent character attached,
instead of replaying seventeen future story states. Its stable fog does not need a
second fogless pass. The loading screen reports completed preparation stages as a
percentage, and the opening frame is rendered without advancing the story.
There is no additional minimum slideshow delay. Visible cinematics start without
clicking the canvas; explicit menus and hidden tabs still pause, and combat still
pauses on focus loss. Default-rig attack/contact samples are reused on retries.

The shuttle's cockpit CSG geometry is generated once and reused. Comic artwork is
prepared before combat. Stealth searchlights remain in the lighting layout when
disabled: intensity becomes zero rather than changing shader light counts on a
drone hit, alarm or hangar entry. Weapon traces skip hidden actors and the player's
own rig before raycasting, and firing-squad searches reject occupied/blocked
positions before allocating a navigation search.

Portable **OGG copies of the supplied soundtrack** are included for browsers
without usable AAC decoding. Music chooses OGG when the browser supports it,
including hashed production asset URLs; the original M4A files remain available.
Regenerate the copies after changing music with **`npm run audio:fallbacks`**.
FFmpeg is a development-only dependency, not part of the browser bundle. If neither
format can be decoded, the game reports an audio-support warning instead of hanging.

The developer menu uses descriptive level/stage names in story order, including
the capital-ship shield and exposed-reactor phases; internal scene numbers are
not shown as misleading level numbers.
Developer jumps and direct chapter entry await the same shared character-preparation
promise as PLAY. Skipping the initial full-game preload therefore cannot enter a
playable chapter without its persistent character. Failed character preparation
is reported and can be retried without creating duplicate rigs.

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

Interaction gestures use the existing upper-body animation layer. Hips and legs
continue their walking/running animation instead of switching to a stationary
whole-body interaction clip. Stealth takedowns use a planted, staggered stance,
a short approach and turn, and robot shutdown synchronized with hand contact.

## Slide tackle

Press **C while sprinting forward with Shift + W** to perform a
**1.4-second slide tackle**. Walking forward does not trigger it. The grounded
slide carries momentum along the starting heading, brakes, and smoothly returns
to walking/running; releasing W lets the recovery come to a stop.

- The authored UAL **Slide_Start**, **Slide_Loop** and **Slide_Exit** clips
  replace the procedural slide pose. The complete sequence follows the physical
  slide timeline; physics owns forward travel.
- Each enemy takes only **2 damage per tackle**. Normal ground patrols and
  jungle sentries fall over, cannot move or attack, then recover after
  **1.6 seconds**. Armoured drones, fixed turrets and scripted bosses retain
  their encounter-specific rules.
- First-person keeps your chosen view with a smoothly lowered camera; **V**
  shows the full animation in third-person. Weapons stay tucked during the slide.
- C still toggles crouch while walking, stationary or moving sideways/backward.
  On touch, hold **RUN** and move forward, then tap **CROUCH** to slide.
- Slides cannot start in the air, vents, zero-G, on ladders, while handling cargo,
  or in the side-scrolling platformer. Jump/action inputs cannot interrupt or
  queue through the slide. Walls, lost ground, menus and scripted traversal
  cancel it safely; holding C never retriggers it.

## Unarmed melee

Select **Unarmed** and left-click to randomly jab, cross or hook with the
authored UAL punching animations, without repeating the previous punch.
Controller attack and touch **PUNCH** use the same attacks. First-person
shows the attacking hands without a weapon.

Punches deal **10 damage**, less than the pistol or melee weapons, with
contact windows synchronized to animation playback. Each punch can hit a
target only once, respects walls and has shorter reach than a weapon.
Menus, cinematics, traversal and the finale's own combat controls cannot
accidentally trigger the on-foot punches.

## Living quarters opening

After the prison prologue, press **E** to let Prime teleport Brondon to his cabin.
The arrival cinematic establishes his room and the crew passage before handing
control back to the player. Hold **Enter** to skip the arrival once the room is ready.
Prime describes the living quarters as having no surveillance, without claiming
they are the ship's only surveillance-free area.

The prison's eye-opening canvas uses a close-up captured from Brondon's actual
cel-shaded model, preserving his magenta eyes, blond hair and angular brows.
Animated eyelid masks retain the flutter, blink and gradual opening.
The camera opens on the three-quarter view of his floating body instead of the
foot end, and returns to that angle after the eye-opening close-up.

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
  device from his bed**. The pistol cannot be equipped before recovery.
  **E** cannot open Brondon's room door from inside until both items are collected;
  Prime's reminder identifies any missing item.
  The teleporter's outbound destination link is blocked for now.
- Every cabin shares a bed, correctly scaled desk/chair assets, a local computer
  with a blue desktop, file window, icons and taskbar,
  and a unique expedition poster. Recover the **purple teleport crystal from
  Brendan's chest** and **scanner goggles from Branden's chest** before leaving.
  **N** toggles the goggles; **Q** places a purple marker and **T** returns to it.
  **Hold Tab** selects weapons, not teleport destinations.
- Look at a nearby chair and press **E** to sit; press **E again** to stand.
  Trying to play Brondon's cabin computer during an unfinished campaign instead
  earns a comic-style scolding from Prime: lock in and rescue the crew first.
  Finishing the campaign and credits permanently unlocks it for subsequent
  **Play** runs on this browser. Developer-menu visits always keep the static
  screen, even after completion, and cannot grant the completion unlock.
  Cabin chairs, surveillance workstations and the equipment archive share the
  authored sitting, seated-idle and getting-up animations. Resting restores
  **1 HP every 4 seconds**, never revives a dead player, and pauses with the menu.
  Movement and weapon use are disabled until the get-up animation finishes.
- Open **M > Ship Map** for a growing map of the sections you have reached.
  Living quarters are charted on arrival; entering Deck One adds the stealth
  passage, storage room and cargo hangar without removing the cabins. The two
  layouts join at the forward bulkhead, with a correctly aligned player marker.
  Locked cabins remain opaque; their furnishings are never exposed.
  Compact room circles use fixed story-order numbers, starting with Brondon's
  room, rather than internal scene IDs. Numbers stay stable as sections are
  discovered. A glowing red dot marks Brondon's exact location at every zoom
  level; nearby room labels move aside so they do not cover it. Elevator and
  objective captions are reduced to keep the map clear.
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
- **Brondon's computer** shows a captured picture of the actual **Play / Don't
  Play** menu during an unfinished normal campaign. No iframe or
  embedded audio is loaded until unlocked. Developer visits (including the
  `?living-quarters` development preview) unlock the computer immediately.
  After genuinely finishing the game
  and credits, subsequent normal **Play** runs also unlock the live game at
  `https://lamp.ms.wits.ac.za/students/sgroup3928/brondons-revenge/?muted=1`.
  Press **E** at the unlocked monitor to sit down first, then pan into the game
  with native browser input. **Close screen**
  pans back out and plays the get-up animation before returning control.
  This iframe requests `?muted=1` and disallows autoplay. Embedded copies of this
  game start both music and effects at zero volume for that flag, without
  overwriting saved audio settings. The deployed game must include that mute
  support for the flag to take effect.
- Use the **number panel beside the forward bulkhead** to zoom in. A glowing
  light pointer tracks the selected button without loading a hand model. Click the digits
  or use the number keys, then **OK / Enter**; **Backspace** erases and **CLR**
  clears. Incorrect codes leave the door locked and display an error.
- Pressing **E** no longer queues the generic Interact gesture for doors,
  posters, computers or chests. Their existing actions and dedicated cinematics
  still run; chair sitting and standing keep their own animations.
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
**Level 1 - Living quarters** entry.

## Level 1 Stage Two: surveillance route

The route is **hangar ladder -> vent maze -> camera hub -> keycard elevator ->
Bay 13**. The old service-passage/storeroom entrance and hidden lift codepad
are no longer part of Stage Two.

- The main hangar airlock stays locked and is marked as a target on both maps.
  Its alternative is the **ceiling vent ladder at the far end**, on the opposite
  wall from the door.
  **E** mounts it and climbs directly into the vents. Rungs, climb travel and
  alternating hand/foot animation share the same ladder spacing and speed.
  The ladder goes straight up through a real opening in the hangar ceiling.
  Climbing always starts upright, even after crouching; **hold Space** to climb
  or descend twice as fast. The airlock reports **Door locked**, then Prime's
  short **We must find another way** line. Looking at the door is not required
  before using the ladder.
- The **34 x 50 m vent maze** has branching corridors, dead ends, six moving
  sensors and six checkpoint pads. An early cross-passage shortens the solution
  from 128 to 60 grid steps, while retaining the branches and checkpoints.
  Use **WASD / arrows** on the fullscreen map;
  the live vent view remains in a small inset. Find the exit without a displayed
  solution line. Green sensors are safe; detection returns you to the last
  blue pad. **Hold Shift** (or **SPRINT** on touch) to crawl twice as fast without
  standing up. Vent walls use the same flat metal panels, deck finish, straight
  trim and cyan strips as the ship rooms; there are no arch-shaped braces.
- The **bottom-right vent chest** contains the first keycard. Recover it before
  dropping into the camera hub; the exit grate opens after collection.
- Dropping out of the maze clears the vent minigame and presents the **Phase 2**
  loading screen. Its artwork is an actual camera-wall screenshot, captured
  without HUD, browser chrome or scrollbars. Camera feeds are prepared before
  the room becomes playable.
- The larger surveillance room has **12 wall screens, 12 furnished desks,
  computers and chairs**, plus server racks. Six wall feeds are active: cargo,
  target range, equipment archive, rust chamber, the **already-cleared vents**, and the
  **already-cleared prologue prison**. The other
  wall screens stay off. There are no decorative wall-text plaques.
- Desk monitors play randomly chosen **looping GIF recordings of corridor bots**,
  not live 3D scenes or teleport targets. Only the camera wall's four unfinished
  minigame feeds allow travel. The prison and vent feeds are view-only.
  The hub has **15 workstations**, with additional stations along the side and
  rear walls; the hangar-airlock approach is clear of desks and server racks.
  After the vent drop, Prime remarks: "Security seems kind of lacklustre.
  I wonder what's going on."
- A guard waits at the centrally placed elevator. Stay crouched, approach from
  behind and press **E** for a silent takedown before using any camera links.
  Open the separate **camera-room crowbar chest** afterward. A noisy attack is fatal; **R** retries
  this local checkpoint without replaying the vents.
- Leave a home marker in the hub with **Q**. Look at a feed and press **E** to
  visit its minigame; **T** returns to the hub. The other decks are under
  surveillance and have **no walking route** from this room. The vent feed is
  view-only and marked cleared. Replacing the home marker elsewhere loses the
  return link; **R** can restart a stranded visit at the surveillance checkpoint.
- Each existing minigame awards an **asset-backed keycard from its chest**:
  clear the cargo stack with the crowbar, solve the range's letter-order puzzle, or recover
  the archive footlocker. Cargo healing, range shielding and the archive
  lightsaber are retained as bonus equipment, never prerequisites for collecting
  a card at full health/shield.
- **Target range:** Prime recalls, "The students would always play in here."
  Read the wall poem and wear the goggles (**N**) to reveal seven shuffled letters
  above the targets. These high-contrast letter plates remain sharp and in their
  original colours through the ASCII scanner, but disappear when goggles are off.
  The framed crew-recreation poster carries the six-line clue.
  Shoot them to spell **BRONDON**; either matching O or N can
  be used first. A wrong-order hit engulfs the room in shader fire, then respawns
  Brondon at the range entrance with all seven targets and the sequence reset.
  Only the complete word unlocks the keycard/shield chest. Completed puzzles and
  collected rewards persist across camera visits; unfinished sequences do not.
- **Cargo hold:** a framed cream-and-orange crew poster on the left wall pairs
  a crow illustration with a drinks bar, bottles and a cocktail glass, not a
  picture of the tool. Its four-line poem hints that joining "crow"
  and "bar" breaks the orange-marked crates to uncover the reward.
- **Rust chamber** adapts Chamber 1 from the rust branch at its original scale.
  Prime identifies it as one of Brendan's simulation rooms. Break the three
  orange header bolts, the orange winch bars and chain, the hanging orange lock,
  and both blue clamps on opposite sides of the hall. The freestanding silver mirror
  at the room's heart guides pistol shots through the first blue clamp to a second
  mirror behind it, which redirects the shot across the room to the other clamp.
  Any hit on a mirror face is guided onto the next element, without demanding
  perfect aim; intervening solid geometry still blocks the shot. Brief blue
  beams show the path. Breaking both intact blue clamps with one mirror shot
  drops a shield crystal from the second clamp, restoring 25 shield when picked
  up. Separate shots still solve the puzzle but do not earn the bonus.
  The bonus persists across visits and cannot be farmed by resetting the room.
  The small blue target on the front
  grille is for practice and is not required to unlock the chest.
  Breaking the winch bars reveals the chain without taking camera control.
  Actual releases smoothly track from the broken mechanism to the door, showing
  connected drive cables, moving chains, rotating gears and descending counterweights
  while the shutter visibly rises. Its sign reads **LOCKED** until all seven
  releases are free. The rebuild control is wall-mounted opposite the door.
  Mirror shots show the first box breaking, then the far box breaking, before
  following the falling fence and door mechanism. The revealed ship door
  opens into a small keycard-chest room only when all seven releases are free.
  Both blue clamps must break before the grille falls flat onto the deck.
  Take the upper stair landing to the narrow rope over the sump and break the
  suspended orange lock with the crowbar or lightsaber. Stair and gantry
  guardrails have solid colliders, with an opening at the rope landing.
  The rope has a sagging braided-fibre finish and tied anchors. Subtle camera
  roll and side-to-side sway build toward its middle and increase with movement,
  easing away when stepping off. Reduced-motion preferences disable the wobble;
  the walkable collider and player movement stay unchanged.
  The arrival console resets the mechanism with **E**, without duplicating a
  previously collected card. Look at the wall poem and press **E** to read it
  with a close camera view; **E** returns to play. Falling into the corrosive
  rusty water visibly melts the character, then returns them to the entrance
  without clearing puzzle progress or collected rewards. There are no sump stairs.
  The entrance has one locked side door; the reward chest faces the doorway.
- Destructibles consistently use **blue glowing corrosion for pistol targets**
  and **orange for crowbar/lightsaber targets**, including cargo, wall targets
  and Bay Warden targets. These effects are always visible without goggles.
  Goggles enable the ASCII view and reveal the range's hidden letter labels;
  they do not recolour or boost destructibles.
  Camera-room desks face their chairs; seating aligns the animated character's
  lower-body contact surface with the actual chair cushion.
- Try the latest card at the elevator with **E**. Earlier cards are rejected;
  the **last of the five collected cards** is valid, regardless of minigame order.
  Revisited rooms do not generate duplicate cards. Swipe the final card, then
  **walk into the elevator and press E on the Bay 13 button** for the intense
  button-press, flickering-light descent, heavy stomps and existing boss intro.
  There is no password or hidden keypad.
- The camera hub is physically connected to the hangar airlock on the **same
  deck**. Its surveillance-side airlock starts locked; once released, it
  provides a return walking link and stays unlocked across revisits and deaths.
  Crossing its threshold or pressing **E** returns to the stealth hangar,
  including after teleporting or entering scenes through the developer menu.
  Developer jumps to any camera minigame automatically place a **Q** marker on
  the surveillance floor, so **T** returns immediately without a manual setup.
  No gameplay hint explains the unlocking interaction.
  On the ship map it sits **directly below the upper vents**; the quarters,
  passage, hangar and airlock join cleanly. Elevators show translucent shafts,
  landing platforms and available/offline stops, rather than a plain line.
  Camera-only minigames appear as separate surveilled-deck charts with purple
  dashed links, **never as stops on the elevator route**.
- Silent takedowns have a shared articulated shutdown animation. During the
  short cutscene other bots pause. **E takedown takes priority over a nearby
  ladder or fault relay**. There are no extra perimeter eye drones; the original
  roof drones sweep every 14 seconds rather than every 26.
  The hallway eye drone has a real searchlight and matching visible cone.
  Eye drones can be shut down by a precise **pistol shot from directly behind**;
  shooting their front armour alerts security instead.
- The prologue's chains and cuffs use the same animated blue hologram shader as
  its holographic figures.
- Scenes **2, 3, 4, 7, 8, 9, 10, 11 and 12** remain as source files, but are no
  longer imported, preloaded, routed or offered in the active developer menu.
  The camera rooms use lightweight crew chests rather than the old model chest.

Developer Mode includes the surveillance route, archive and camera-room previews.
In development, `?stage2-infiltration` starts at the vent entrance;
`?stage2-hub` starts at the uncleared camera-room guard checkpoint.
Both provide the earlier cabin equipment; the crowbar and lightsaber are still
recovered during Stage Two.

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

- Scene 14's hangar matchup reads **BRONDON VS TRILOBOT SWARM**.
- Scene 15 preserves Scene 14's launch position, heading, camera and speed,
  smoothly settling into the chase camera while the shuttle flies **alone for
  two seconds**. The capital ship then **fades in from the distance over 1.25
  seconds**, before the matchup appears.
- The Scene 14-to-15 handoff is seamless, with no interceptor loading screen.
  Interceptor loading artwork appears only when entering through the developer
  scene menu; the later flight-phase developer jumps retain their own artwork.
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

### Hangar actions and shield pickups

Hangar 14 uses four timed inputs: **Y** (shoot), **U** (crowbar), **I**
(dodge) and **O** (lightsaber spin). The running shot and skeletal animation
continue in slow motion while a prompt is visible. A timely input smoothly
restores motion; a missed input blends into the death shot from the current
position. Both cinematic strikes and ordinary melee hits show comic impact
words, including crowbar and lightsaber fights.

Level 2 shield pickups have a distinct violet/cyan halo. Up to three charges
are shown beside the hull-health bar. Activate with **Enter**, the controller
shield button, or an icon. Each lasts **20 seconds**, with a circular countdown
around its icon; charges are consumed from the rightmost icon to the left.

### Continuous facility approach

The former scenes 17-19 are one continuous ship-to-facility exterior.
Scene 18's side-scrolling course, relay platforms and bridge-collapse sequence
have been removed. The western half is an impassable, weathered-rock mountain.
A waterfall feeds the river, with a flowing, lit water shader, surface ripples,
dense aerated sheets, animated impact foam and spray. Waterfall and river share
their colour/foam palette; the curved curtain conceals the entrance until the
player passes through it. Faster cascading flow and impact spray retain the
river's green-blue water colour rather than making the whole curtain white.
Passing under the torrent bends the sheet around Brondon and sheds droplets
from his head and shoulders. These splashes use a fixed particle pool with
world-space flight, gravity and surface impact, including when crouched.
The cave's tunnel is stitched to the mountain's exact opening in one mesh:
shared vertices, normals and world-space rock shading eliminate gaps and
separate texture seams. Its closed back, worn rock walls and stalactites replace
the box-shaped room. The mountain has a sloping, contoured
front and rolling ridge with a rock spillway rather than a flat extruded wall.
The falling sheet follows the mountain's profile with clearance rather than
intersecting it near the summit. A contoured stream, bank rocks and a tree grove
hide the source's straight edges. The river fits the terrain's exact west/east
bounds, with a rocky, wooded eastern end bank instead of water past the map edge.
Textured canopy clusters, bark, ferns and gentle GPU wind retain distance-based LOD.

The stone trail extends behind the landing site and connects exploration loops
on both riverbanks to the main route and waterfall branch. Decorative flagstones
do not each allocate a physics body; terrain carries the player. Bridge posts and
rails have collision bodies and are removed with the bridge if it breaks.
The waterfall branch has a continuous solid ledge extending beneath all crossing
stones and beyond the curtain to overlap the riverbanks. This support remains
active independently of distance culling, so walking beneath the falls does
not drop the player through a decorative stone into the river.
Its stone surface and collision top sit 6 cm above the ground and cave floor,
preventing coplanar z-fighting. Flagstones stop before the waterfall curtain and
do not continue into the secret cave.
The stone trail stays safe
from the dinosaurs off the route. Normal Trilobites patrol before the intact
bridge, and spider bots patrol only beyond it.

River sharks swim below the surface with their fins barely showing. Falling
into the river starts a continuous shark-swarm scene before death and a return
to the landing checkpoint, rather than killing the player immediately.
Sharks are fitted in their animated pose with height and length limits. Brendan
uses `DonfromStreets.glb`, preserving its original materials and rigged animations.
He shares Brondon's two-tone cel shadow shader, stands and talks after leaving
the pod, then independently paces around the wreck and pauses to inspect it
while the player explores. Standing clips are selected explicitly rather than
matching crouched idle animations.
The same actor appears in the landing film,
playable jungle and final surface transmission. The landing film uses the same
culling-aware forest as gameplay.

The waterfall detour is optional. Going behind it shows **BRONDON VS ROGUE
SPIDER BOT** in side-by-side panels with a vertical divider and comic speed
lines radiating outward from the central split, and seals the arena for the
hopping spider miniboss. Every
weapon remains available. Defeating it unseals the arena and awards the secret
**BEHIND THE FALLS** achievement, shown in a timed comic-book overlay.
The achievement survives exterior respawns and facility transitions without
replaying its announcement. No Aegis chest or final-boss immunity is granted.

Ship-styled facility sentinels can be destroyed with pistol fire or returned
lightsaber-parried beams. The facility's full rear wall is covered by the supplied
group photo, with **SUDOERS HIDEOUT** centred in outlined comic lettering.
The mural is shared by the landing, jungle and finale exterior so the building
stays visually consistent. Finding it behind the building in Scene 17 triggers
a one-time, ten-second discovery cutscene: Prime starts recognising the picture,
but Brondon cuts him off and insists they get inside to save the students.
The camera pans to the mural, combat and movement pause, and normal play resumes
from the same spot and view afterward. The discovery remains recorded across
landing-checkpoint retries.
The facility door opens as the player approaches. Both directions between
Scenes 17 and 20 use the standard chapter-loading flow and shared sliding-portal
handoff: position, velocity, facing, held inputs and health carry across the
matching doorway frames. Walking back out returns to the exterior entrance,
not the landing checkpoint. There is no scripted six-metre walk or entry-camera
blend. Preparation failures retain the standard retry screen.
Prime says, "I expected more security."

The AI room uses the updated `earth` branch control-room styling (`55b4433`):
a bright teal/white palette, green holographic planet dome, concentric floor and
ceiling rings, daylight skyline panels, wall displays and bookshelves. The
four-station puzzle and stairwell barrier remain intact. All four data logs are
grouped in the ground-floor archive on the left side near the entrance.
The controls are physically scrambled (REACTOR, COMMS, COOLANT, VENT from left to
right); read the logs to deduce COOLANT, REACTOR, VENT, COMMS rather than following
their positions.
Workstations use the same authored desk and chair models as the cabins, grounded
and uniformly scaled, with matching rotated colliders and monitors on the desktops.
The eight computer monitors display the real `https://fla.capitalsigma.biz/`
website continuously as depth-occluded CSS3D surfaces, including while walking
past. **E** pans into a monitor; the normal browser cursor interacts with the live
page. Use **Close screen** to pan back out. Data logs, puzzle controls, wall
displays and windows do not show this website. The external site's availability
and permissions still apply.
The wall screens instead show the supplied **SUDOERS HIDEOUT** photo with an
ink-bordered yellow title strip. The high entrance window clears the door sign;
round windows have recessed panes and raised metal rims below the mezzanine.
On entry, comic dialogue panels show Brondon saying, "This looks more like a
resort than a prison," followed by Prime's "Could it be...?"
From Scene 17, the open doorway shows an unlit black aperture until the player
crosses into Scene 20.

The stairs have illuminated tread edges, structural stringers and sloped glass
railings. Only the upstairs holographic lab fit-out from `earth` (`1c28dc6`) is
imported: framed circuit panels, blueprint display, touch consoles, ceiling beams
and cyan lighting. The five original Subject models and their conference table
sit in the open middle of the top-floor room, using their authored sitting
animations. Glass panels run along the balcony edge, not around a smaller inner
office. After solving the panel, approach the glass door at the stair landing
and press **E** to peek.
The camera eases toward the glass; the five notice Brondon and turn toward him,
then the scene ends and the finale begins. Merely reaching the upper floor does
not end the scene. Stairwell power stays unlocked on a round trip outside.

## Scene 21: Final boss

Stage One's first Deck One entry and the initial final-boss entry use cinematic
loading screens with a randomly selected destination screenshot and gameplay tip.
They remain visible for at least **three seconds**, and longer when assets are
still loading. Returning to storage, retrying a boss checkpoint and all other
scene transitions retain their existing seamless handoffs. Entering Scenes
13, 14, 15 and 16 shows the same short **CHECKPOINT SAVED** banner as Stage One.

Scene 20's observation-deck reveal leads into the Sudoers 5 finale. The taller summit room
has cold, desaturated ceiling spotlights and synchronized student dialogue. The roof
blows clear, the students enter their mech one at a time, and the shuttle recalls
from its Scene 17 jungle parking spot to morph into Prime Frame. A comic VS
screen introduces the fight; there are no generated platforms under the mechs.
After the transformations, dusk deepens into a moonlit, starry nighttime rooftop.

Use **A / D** to move and **direction + J** to select an authored sword attack.
Neutral **J** chains the classic, left and finishing cuts. The free Standard
animations retain their complete anticipation, contact and recovery at their
authored playback speed. Blade afterimages fade in **0.085 seconds**, with softer, narrower
trails and restrained charge glow and impact sparks. Damage follows the animated blade sweep; luminous cuts remain on damaged
armor for **1.65 seconds** before fading. **F** sheaths the sword, draws the
back-mounted rifle and fires a two-handed salvo. **Hold R** for a draining shield
or timed parry, and **Space** for a dodge boost with **no energy cost or recharge**.
Boosts can also cancel a committed move once its cinematic close-up is over.
The rooftop fighting bounds are subtly wider; the facility perimeter and its
colliders extend to the enlarged deck edges as well. **E** charges **Last Light**, then
releases a flying blade flash; it starts ready and recharges in **18 seconds** of
combat time. **W / S** control altitude in space. Shielded hits are fully absorbed,
including the hit that breaks the shield. Blocking recoils melee attackers and
deflects projectiles; a timed parry reflects them toward Sudoers 5.

Sudoers 5 jumps forward into its thrust, uses a reverse diagonal cut, and leaps
backward before charging its sword-tip beam, whose deep red matches its armor glow.
In orbit it also uses **Eclipse Rend**, a sword rush with its own cinematic tell
and a dodge/parry window. The jumps move the actual combat
body in both rooftop and orbital fights. Recovery reminders, adaptive exploration
hints and introductory control cards are disabled during the finale; attack tells
and resource warnings remain during combat. Special-move close-ups return to the
normal camera **at least 0.55 seconds before firing**. Both fighters are protected
from unrelated attacks during the introductory close-up; dodge or guard when
gameplay resumes. Release R to recharge the shield.
Shielding uses an open, extended off-hand stance instead of the pushing animation;
the sphere follows the center of the fighter. Orbital locomotion blends a
momentum-driven flight stance with the same original attack animations as on the roof.

The facility's centre contains a softly lit silver-and-mint floating core on its
dais, sharing its shell and three orbital bands with the planet breaker.
Before the orbital phase, the enemy poses, jumps back and raises both hands.
The camera cuts inside the facility as the core dematerializes in a pixel breakup,
then cuts back to show it rematerializing above the hands and arming red.
The enemy launches it skyward and commands its descent. The camera
follows the meteor into Earth, then shows the explosion with a large **BOOM!**
using the same starburst, halftone and ink artwork as other comic impact words.
The final surface transmission returns to Brendan's `DonfromStreets.glb` actor
in the burning rescue forest. A dedicated close-up tracks his head, with the
volumetric fire shader attached to the head bone and progressive surface scorching.
Brendan cries, "Ahhhhh, it burns!" Inside Prime Frame's cockpit, Brondon answers,
"Nooooo, Brendan!!" and vows to the Sudoers, "I will never forgive you. You must
die. I will have my revenge!!!"
The space sky, planet destruction, burning-head shot and cockpit resources share
the finale's single preparation pass. Orbital fog is disabled
through its distance uniforms rather than switching shader variants, and rooftop
shadows stop updating without changing the light's shader configuration.
The sequence cuts between locations instead of flying the camera through terrain.
Its eased, curved pullback starts at the actual cockpit camera; the cockpit fades
out as Prime Frame is revealed, with both mechs in airborne fighting stances before
the orbital duel resumes. Music continues without restarting. The bomb begins
its descent at the apex rather than pausing there.

The final execution is a **28.55-second, input-independent cinematic**. There are
no prompts, grades, input pauses or missed-command deaths; future QTE overlays can
follow the film clock without controlling it. Brondon evades Final Verdict,
parries a second attack, returns rifle fire, locks blades, cuts through, ascends
and charges Last Light. The extended clash cuts from sparking steel to Prime's
face and Final Verdict's face. The following slash is framed just behind Prime's
sword shoulder. The vanishing rush reappears behind the enemy before forty
staggered slash accents, with a physical recoil for every hit and an authored
death pose. Root trajectories preserve momentum across cuts. Blade-contact IK
keeps the bevelled sword surfaces separated instead of passing through each other;
combat shields are not carried into the execution.

Planet impact dissolves the textured crust and clouds, revealing an opaque,
animated solar-fire surface. In the clearing, Brendan uses his authored
`Fixing_Kneeling` entry, then `Death01`, with the standing anticipation trimmed to
match the kneeling hip height. Head fire follows the actual head bone throughout
the fall. The cockpit cut waits until that surface shot finishes.

Prime's native dance has a full-body shot **before** the return of the actual
Scene 1 mothership. The ship enters along a banked curve, brakes into its final
heading and continues smoothly into the epilogue. No automatic bloom/temporal
trail is added to Prime; the normal display bloom controls are unchanged.
Centered credits run in **90 seconds**, with
rolling text but no background dancing copies or sprite generation.
A visible **hold Enter to skip** control
skips the boss introduction; the same control skips the ending dialogue in
Scenes 13 and 16 without losing their unlocks or scene handoff. Scene 1 ends
directly on **Play / Don't Play**, with no opening credits roll.
Scene 1 has a small **View Credits** button in the bottom-right corner of its menu.
**View Credits** is also available in the pause and developer menus. Its scrollable
credits sheet and the rolling credits use the game's comic typography, halftone
paper panels, ink outlines, offset shadows and coloured caption badges.
The credits sheet shares the end roll's attribution list: creation and story by
**CHASS**, music by **Caleb** produced in **GarageBand for iOS**, the new Brondon
and DonfromStreets (Brendan) GLB models by **Husain**, and the other generic
character models from **Quaternius's Universal Animation Library (UAL)**.
It also credits animation authors, engine/physics libraries and development
tools. Unconfirmed asset sources remain explicitly marked for
verification rather than assigned to an author.

The shuttle recall preserves its parked world transform, lifts clear of the ground
before forward flight, then follows a curved approach to Brondon. Donus returns
along a banked, decelerating flight path rather than sliding between two points.
Signature moves display **Starfall Salvo**, **Last Light**, **Final Verdict**,
**Eclipse Rend** and **Planet Breaker** during their cinematic wind-ups.
Mech clips are retained between frames instead of being stopped and restarted.
Cinematic poses blend across attacks with controlled guard, weight transfer and ascent;
damage reactions retain their sampled motion and momentum.

Combat animation assets are taken from the downloaded, free **Quaternius Universal
Animation Library 1 and 2 Standard packs**, under CC0. All seven supplied sword
attacks are baked onto the MC and Subject bind poses; matching bone names alone
are not treated as matching bone axes. Only animation tracks are included, not
the packs' demo meshes or paid Source assets. The runtime caches the baked library
before gameplay and does not retarget or bake it on each swing.

For **keyboard and mouse lightsaber combat**, left click chooses a random
authored cut, lunge or regular combo, avoiding consecutive repeats. **Three clicks
within 450 milliseconds** queue the heavy combo. The current swing finishes
before the heavy combo begins; rapid input does not restart or abruptly cut an
animation. Movement keys no longer select mouse-click attacks.

Controller/touch lightsaber attacks and the **final-boss sword** retain these
direction mappings. Attack means the controller/touch attack button for the
lightsaber, or **J** in the finale. Directions are captured when attacking,
including queued attacks; moving the stick afterwards does not change a queued move.

| Keyboard / left stick + attack | Authored move |
| --- | --- |
| W / up | Sword Dash lunge |
| A / left | Regular A left cut with its recovery |
| D / right | Regular B right cut with its recovery |
| S / down | Regular C finishing cut |
| W+A / up-left | Full Regular Combo, three contact windows |
| W+D / up-right | Full Heavy Combo, four contact windows |
| No direction | Classic Sword Attack, then left cut, then finishing cut |

Down-left selects the classic cut; down-right selects the finishing cut.
First-person hands use the FPS-hands branch's weapon grips for the crowbar,
two-handed pistol (with recoil), and lightsaber, with idle fists when unarmed.
They appear both when toggling to first person and when a wall forces the
shoulder camera into first person, then disappear when shoulder clearance returns.
The hands render in a separate depth-cleared view so nearby walls do not clip
the held weapon; pistol muzzle effects remain aligned with the grip, and melee
damage continues to use the gameplay attack paths rather than the overlay.
Lightsaber first-person presentation follows the animated hand and blade, not a
separate generic swing arc. Gameplay lightsaber clips play at **1.6x speed** with
**70-millisecond attack blends**; both camera modes share the same scaled animation,
cooldown and contact-window timing. A **360-millisecond parry window** opens on
the initial click and each combo contact, with a **200-millisecond perfect window**.
This makes approaching beams easier to reflect without speeding up the finale
or damaging targets during recovery/idle poses. Separate combo strokes
can hit a target once each, and holstering cancels pending swings and parries.

In the finale, **G** stows/recalls the sword and rifle on the frame's back; unarmed
**J** chains the imported jab, cross and hook. **C** uses the imported grounded
slide start, carry and exit, with sampled foot contact rather than sword reach.
The final cinematic recalls the weapons automatically. Sword Block supplies the guarded
stance without making the head inherit the torso's shield rotation. Evasions and
boosts use the authored airborne pose where appropriate. Cinematic root motion is not overlaid with a
second velocity-driven body lean.

To regenerate the compact animation library from the extracted Standard GLBs:

```powershell
npm run animations:import -- "C:\path\to\quaternius-import"
```

That directory must contain `UAL1_Standard.glb` and `UAL2_Standard.glb`. Original
sources: [Library 1](https://quaternius.com/packs/universalanimationlibrary.html),
[Library 2](https://quaternius.com/packs/universalanimationlibrary2.html) and the
[interactive rig viewer](https://quaternius.com/animviewer.html).

Every pose restores its cached, unmodified bone sample before IK, head tracking or
secondary motion. This prevents rotations from accumulating when Three.js skips
an unchanged animation sample. Blade locks settle under pressure; rifle hits and
the final cut use a controlled recoil/recovery instead of repeatedly scrubbing a
damage clip back and forth. Breathing is subtle and does not add independent leg,
hip or head oscillations.

For local playtesting, open the pause menu, select **Developer Mode**, and click
**Unlock**. No password is required.
The final-boss shortcuts include **Bomb release / 50% health**, which starts at
the exact bomb-release frame with **900 / 1800** enemy health, and **Final cinematic
start**, which starts the execution at time zero. Loading warm-up does not advance
either checkpoint's timeline. **Epilogue - Rolling credits** jumps straight to
the actual end credits, with the same music and 90-second text roll
as a completed game; it does not replay the boss fight.
Shielding keeps the mech's head facing forward;
its normal opponent-tracking remains separate from the guard's torso/arm pose.

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
      level 3/              Continuous approach 17, facility 20 and final boss 21
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

The route is scene 16 crash landing -> scene 17 continuous facility approach ->
scene 20 research facility -> scene 21 finale. Scenes 18 and 19 are no longer
separate gameplay scenes. The finale builds a compact presentation of the same
facility summit, shuttle clearing and forest cutaway. It does not reconstruct
the playable bridge, waterfall, mountain cave, sentinels or traversal colliders.
The distant canopy uses two instanced batches rather than the full jungle level.
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
debris in orbit. The final execution plays to completion without input gates or
timing failures; normal gameplay input cannot redirect the film. HUD panels, recharge
indicators and controls use the game's shared comic-paper panels, ink outlines,
hard shadows and resource colors; the VS and game-over layouts are preserved. Hold **Enter** during the
reveal and transformations to skip ahead to the VS introduction.
Victory credits are centered without background dancers or character sprite rendering.
Brondon's cockpit close-ups use the same character model as on-foot gameplay;
Prime Frame retains its existing mech model.
The epilogue also flies in the shared opening mothership and plays Prime Frame's
native `Dance_Loop`; the credit timeline and scrolling share one duration.

## Tech Stack

- **Three.js** -- 3D rendering
- **TypeScript** -- Type safety
- **Vite** -- Dev server and bundler
## Five Chairs trailer and loading artwork

**Developer Mode > Scenes > Trailer - Five Chairs** appears immediately below
**Brondon's Museum**. The standalone scene lives in `src/scenes/trailer/`.
It plays for 18 seconds, pulling back from the middle chair to reveal five
evenly spaced Vergil chairs from a 35-degree downward angle. Independent
skeleton clones keep the chairs in their own positions. The chairs stand on
dark, textured ground with warm sunset backlighting, cool fill, contact shadows,
and drifting wind dust. The wide composition places the ground's far edge at
three-quarter frame height.

On completion it opens the developer scene-selection menu again, exactly once.
Pausing stops the trailer clock; resuming continues the same shot.
`src/assets/loading/finale-chairs.png` is the 1920 x 1080 still of this composition
used by both the final-fight and trailer loading screens.

