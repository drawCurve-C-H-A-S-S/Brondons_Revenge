# Brondon's Revenge

A 3D browser game built with Three.js for the COMS3006A CGV project.

## Game activity diagram

- [View the vector activity diagram](./GAME_ACTIVITY.svg) -- zoom or print
  without losing sharpness.
- [Edit the Mermaid source](./GAME_ACTIVITY.mmd).

The diagram covers the normal story campaign, Arcade/Museum mode, decisions,
retries, optional exploration and the shared on-foot gameplay loop. Developer
shortcuts and removed legacy scenes are excluded.

To regenerate the image locally with Mermaid CLI:

```bash
npx --yes --package=@mermaid-js/mermaid-cli@11.12.0 mmdc -i GAME_ACTIVITY.mmd -o GAME_ACTIVITY.svg -b white
```

Open the SVG in a browser or vector editor. For paper output, use a large/custom
page or poster tiling; fitting the entire long diagram onto A4 makes labels too
small.

## Development video

- [Development vlog script](./DEVLOG_SCRIPT.md): narration and technical references.
- [Discussion outline](./storyboard/index.html): topics and talking points for
  your own recordings, following the script's 4:50 target. No screenshots,
  video uploads or animatic playback are required.

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

### Code quality

Check linting, formatting, and TypeScript without changing files:

```bash
npm run check
```

Apply ESLint's safe fixes and format the codebase:

```bash
npm run lint:fix
npm run format
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
Scene 1 is the **Main Menu**. Its straight blue-and-red **BRONDON'S REVENGE**
title fades in from a blur with a brief chromatic glitch. It then pulses slowly,
with "A tale of vengeance" underneath as a subtitle. Its straight comic-paper
buttons and ink frames retain the Sefa font, cyan/red accents and subtle
techno highlights; this fusion is scoped to Scene 1. Choose **Main Menu** from the pause menu to
return after confirming that no progress will be saved. Returning discards the
current run and skips the opening camera animation; a fresh page load still
plays it.
Entering Brondon's Museum through Developer Mode enables the same painting
minigames and results flow as Arcade Mode. Selecting another developer scene
clears the active Arcade run and uses the regular developer equipment access.
Minigame progress resets for each Arcade launch and developer scene jump.
Once Developer Mode has been unlocked, **Return to Museum** is hidden from the
pause menu; the Museum is still available through the developer scene list.
At the center of the Museum, beneath the open sky, the prison's blue light
effect marks the Main Menu exit. Stand in it and press **E** to open the
no-progress-saved confirmation.
Only nearby interaction prompts appear in the Museum; there is no persistent
movement-instructions overlay.

### Arcade challenges

Arcade rules are isolated from Story mode. Entering a museum screen opens a
pre-start briefing; gameplay and the run timer remain paused until **Start**.
Title, mode, character, difficulty and briefing menus support controller
stick/D-pad navigation, confirm and Back, including loading retry menus.
Run timers and Arcade instructions sit at the bottom-centre, above the player
HUD. Keyboard **Shift** and the controller sprint trigger work in the museum
and on-foot Arcade challenges; the hangar does not force Story's stealth crouch
or limited stealth-sprint meter in Arcade.
The Level 1 wing has exactly four screens:

- **Deck One Hangar:** choose **Easy** (climb the exit ladder), **Medium**
  (disable every hangar eye drone, then climb), or **Hard** (disable every
  hangar eye drone and ground scavenger/shell bot, then climb). The exit ladder
  refuses ascent while required targets remain. Cargo ladders still work.
- **Camera Room:** starts in surveillance with the vent maze already cleared.
  Complete the six existing camera minigames, collect their keycards, return
  to the elevator and swipe the accepted card. The millisecond timer starts
  with **Start** and excludes loading, menus and pauses. Built-in camera-room
  cinematics, teleport presentations, Rust chamber camera shots/death
  presentations and range-failure explosions are skipped, applying their
  gameplay outcomes immediately rather than watching and subtracting them.
  Camera-room teleports and keycard pickups do not finish the run. Results
  offer an optional styled **PNG image** downloaded locally; no upload,
  screenshot service or external assets are involved.
- **Bay Warden:** time and health challenge, ending immediately after the
  successful finisher QTE rather than waiting through victory dialogue.
- **Escape QTE:** ungraded; ends when the ship leaves, without continuing into
  the flight chapter.

The flight screen and **Final Fight** remain available. **AI Research Facility**
is removed from the museum, but remains in the Story campaign.
**Bridge and Waterfall** becomes an Arcade-only survival run from the southeast
trail. A solid metal gate blocks the bridge; follow the existing trail west to
the waterfall instead. Brendan, the pod, the ship and their colliders are absent.
Scavengers, shell bots, eye drones and dinosaurs replenish continuously from a
reusable pool of exactly **four regular enemies**, with at most **four
simultaneous attackers including the Warden**. Replacements spawn one at a time,
at least 2.5 seconds apart. Distant enemies are suspended without releasing their
population slots, so running away cannot spawn an extra crowd or activate
distant physics chunks. Separate Story sentries and sharks are absent, and
facility turrets cannot attack in this challenge.
The trail has a rear start fence, side fences, a safety deck over water edges,
and protected access to the full Warden arena. Gate and fence colliders derive
from their visible meshes. Route confinement preserves forward/tangential
running speed and rejects off-route teleport markers. Enemy animation and
conservative hit bounds are budgeted separately to avoid per-frame skinning
overhead.
Arcade dinosaurs can be defeated and use non-instant-kill attacks; Story
dinosaurs retain their existing behaviour. Defeating the Waterfall Warden ends
the challenge without entering the research facility.

Boss and waterfall grades weight health remaining at **60%** and speed at
**40%**, with a retry penalty. Speed targets are **8 minutes** for the Bay
Warden and **5 minutes** for the waterfall run. The camera speedrun uses a
**15-minute** top-rank target and records the exact active time independently
of its letter grade. The pre-start briefing displays the relevant target.
The museum's northeast corner, between Levels 1 and 3, displays a scaled copy
of Level 2's enemy capital ship on a labelled plinth, using the original flight
model factory without its combat logic.
The telescope displays the animated `ROLL.gif` asset inside its circular
eyepiece, replacing the former text. It loads only when looking through the
telescope, reuses the cached asset URL when available, and releases the image
on exit. Image-load failures show a retry message rather than a blank view.

### Menus and display

Scene 1 suppresses automatic controller notices and gameplay control popups;
the right stick rotates its mothership view while the left stick/D-pad navigates menus.
Choosing **Story mode** opens setup before the story: controller calibration,
display/Prime hints and sound are available before **Begin story**.
**Sound** is available from the pause menu in every scene, including Scene 1.
Vertex and fragment GLSL files live in `src/shaders/vert/` and
`src/shaders/frag/`; shared GLSL chunks remain in `src/shaders/`.
Player cel-shading fragments are imported by `src/core/loader.ts`, preserving
the existing model-material application and shading toggle.
**Display** includes a **Menu font** choice: **Normal** keeps Sefa on
Scene 1 and the original fonts elsewhere; **Serra (Sefa) everywhere** and
**Comic Sans** apply their font to all menus. It also includes a **Bloom**
strength slider, **Hide HUD**,
**Show FPS**, **Perf timers** and **Prime hints**. Preferences, including sound,
reset on page reload; they remain active across menus and scenes for that page session.
Campaign completion and asset caching are separate and remain persistent.
Loading screens use Sefa titles and contain no field notes.
Press **Backslash (\\)** outside a text field to cycle bloom off, bright and soft.
With **Show FPS** enabled, **Perf timers** adds CPU rendering time and GPU time
when the browser supports GPU timer queries.
**View Ship Map** appears only in ship-interior scenes; the opening, flight,
planet and finale scenes do not expose it. The normal minimap and its comic
frame are both circular.
Weapon and scene control cards dismiss automatically after **12 seconds**,
or immediately with **H** or their close button. A newly introduced mechanic immediately replaces an older control card,
even before its timer expires or **H** is pressed. Controller bindings use SVG
face buttons, shoulders, triggers, sticks and directional pads both in these
new-mechanic pop-ups and in the complete Controls menu. The icons follow each
controller's selected family, calibrated layout and face-button swap.
**Prime hints (all levels)** is under **Controls** in the pause menu throughout
the game. The Controls panel stays upright and shows a scrollbar and scroll
cue when more bindings are available.
It is **on by default**, and the choice is saved between visits. Optional Prime
guidance is available across the playable levels, with short contextual hints
spaced apart using gameplay time; pausing or watching a cutscene does not advance
them. Turning the setting off hides active hints immediately, including stealth,
room guidance and boss coaching. Story/cutscene dialogue, objective feedback and
mechanic control cards are not muted by this preference.
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
The **Button-label layout** dropdown selects Switch, Xbox, PlayStation, or
generic labels for the selected controller.

**Calibrate game controls** is available only inside the **Controller** tab,
never under Keyboard & Mouse. Calibration asks for only the **15 buttons used
by the game**: four face buttons, both shoulders and triggers, four D-pad
directions, the menu/skip buttons, and the right-stick click (R3).
Both sticks' directions are calibrated too, for **19 steps total**.
Left-stick clicks, Home/Guide/PS, Capture/Share/touchpad press and unused
extra buttons are not requested.
Follow the labels for your chosen family; release every button and center both
sticks before starting. Axis-based triggers and D-pads are supported.
Calibration and face-button swaps are retained separately for each device and
controller family for this page session, including reconnects.
You can cancel halfway with **Escape**, **Cancel calibration**, or by holding
**any two controller buttons together for one second**. Cancellation discards
the incomplete setup and retains the previous layout.

| On-foot action | Switch | Xbox | PlayStation |
| --- | --- | --- | --- |
| Move / look (yaw and pitch) | Left / right stick | Left / right stick | Left / right stick |
| Jump | B | A | Cross |
| Toggle crouch / sprinting forward tackle | Y | X | Square |
| Sprint | Hold ZL | Hold LT | Hold L2 |
| Shoot / swing / slash | R | RB | R1 |
| Interact / use / collect | A | B | Circle |
| Weapon wheel (right stick selects; release to equip) | Hold L | Hold LB | Hold L1 |
| Cancel weapon selection / menu back | B | B | Circle |
| Menu confirm | A | A | Cross |
| Place teleport anchor | D-pad Down | D-pad Down | D-pad Down |
| Throw teleport crystal (hold/release to charge) | D-pad Right | D-pad Right | D-pad Right |
| Return to teleport anchor | D-pad Up | D-pad Up | D-pad Up |
| Dance (keyboard 9) | X | Y | Triangle |
| Scanner goggles | ZR | RT | R2 |
| Change camera view | R3 | RS (right-stick click) | R3 |
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
In **flight**, use left stick to steer, right stick to aim, hold R to fire,
B to evade, A to activate a collected shield, R3 to change view and + for the menu.
The arcade flight phases retain their directional dodges with left stick + B.
During the **hangar escape QTE**, the displayed controls are R (shoot),
X (crowbar), B (dodge), Y (bloomstick spin), and A (launch).

The **final boss** uses left stick for movement and space altitude, R to swing,
X for the rifle salvo, hold ZL for shield/parry, B for dodge boost, and A for
Brendan's Will (the existing 18-second recharge). Y performs a grounded slide tackle
that briefly knocks Sudoers 5 down.
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
| Prison prologue | Prologue less mashing, decoded before the scene begins and started at full gain |
| Prime breaks the prison chains | BrokenChainsBGm, switches at the chain-break frame |
| Living quarters | Living quarters |
| Stage One, first half | Stealth1 |
| Stage One, second half | Stealth1 2 |
| Stage One, caught or hangar alarm | Stealth1 3 |
| Stage Two vent maze | Tension |
| Stage Two camera minigames | Stealth1 2 |
| Museum and AI facility | Puzzle |
| Bay Warden, starting at the service-elevator entrance | DonRevBGM1 |
| Hangar 14 escape | Final battle |
| Level 2 flight and scrambler phases | DonRevLevel2 |
| After destroying the red scrambler, including the crash handoff | DonRevLevel2Boss |
| Planet jungle and bridge | Planetbfm |
| Hidden waterfall fight | Some boss |
| **M** pause menu and its submenus | Menu |
| Boss defeated | Existing area music continues without a victory-song override |
| Final boss introduction and transformations | Loading |
| Playable final boss duel | Three-second crossfade into DonRevBGM1 |
| Planetary collapse and final surface transmission | BrokenChainsBGm |
| Orbital duel, finisher and victory | DonRevBGM1 |
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
when the prologue hands back control. DonRevBGM1 plays through the Bay Warden
arena and its entrance; Final battle plays in the hangar escape.
Tension plays only while Brondon is inside the vent maze;
dropping into the camera hub returns to Stealth1 2.
DonRevBGM1 carries the ground duel. Broken Chains crossfades in for the Planet
Breaker and its surface transmission, then DonRevBGM1 returns for the space
duel, finisher and victory. The credits cue takes over when the credits begin.
Opening any chest, whether a cabin footlocker or a minigame reward chest, plays the
Chest sound effect through the sound-effects volume.
Music uses decoded Web Audio buffers rather than streaming-element loop restarts.
Loop padding is trimmed and the seam is blended over **0.65 seconds**. Ordinary
soundtrack changes use a **0.9-second equal-power crossfade**; the final boss
entrance keeps its **3-second** transition. Outgoing music stays audible while
the next track loads, and rapid cue changes retain the music already in the mix.

## Sound effects

The sound-effects slider keeps its 0-100% range, but its maximum output is now
**30% of the previous maximum**. This applies to recorded effects, synthesized
weapon/ship sounds and ambient water, without reducing music.

Footsteps are original, low-pitched synthesized thuds. Their left/right contacts
are sampled from the actual walking, sprinting, crouching and crate-handling
animations, rather than triggered by a movement-distance timer. The same timing
is used in first and third person; airborne movement, slides and teleports do not
produce walking sounds.
Footsteps have a separate 1.45 gain; robot clanks are mixed at 0.22 of their
requested level. Breakables and bounce pads use short synthesized impact sounds;
mechanical whirs and projectile sounds remain deliberately quiet. Shield-only
damage flashes blue, while any damage reaching health flashes red.

The waterfall uses a decoded, sample-clock loop with a **two-second blended seam**.
Its volume decreases continuously with distance, reaching silence at **110 m**.
Leaving and returning resumes the loop instead of restarting the recording.
Water ambience pauses with the menu or a hidden tab and follows the effects slider.
Browsers without Web Audio report that browser-native looping is being used.

## Loading and caching

Starting the story uses only the new ship screenshots in the prologue loading
loop: cabins, stealth bay, cargo, Bloomstick tennis, target range, reactor and
both rust chambers. The empty surveillance capture is excluded until replaced.

The opening requests **Loading.ogg first**, before model loading. The mothership's
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
an estimated timer; its status names the job currently running rather than the
last finished job. The prison's cutscenes and first-render shaders are prepared
before the game starts. Failed preparation stays on the loading screen with
**TRY AGAIN**, retaining successfully cached files.

All runtime models, their external texture/buffer dependencies, music, surveillance
footage, screenshots and chapter code are loaded up front. Unused authoring assets
and obsolete scenes are excluded. Full-resolution planet maps are generated
offline and loaded as losslessly compressed RGBA pixels, avoiding repeated
procedural-noise calculations during startup without changing texture quality.
The maps use a binary asset extension to prevent automatic HTTP gzip decoding,
and use the normal session/production asset cache. After changing the planet
generator, regenerate them with **`npm run textures:earth`**.

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

The soundtrack and the chest sound effect ship **only as OGG Vorbis** to keep the
bundle small; no M4A copies are included. A browser that cannot decode OGG
reports an audio-support warning instead of hanging. To add a track exported as
M4A, drop it into `src/assets/bgm`, run **`npm run audio:fallbacks`** (it converts
every M4A in that folder to OGG), then delete the M4A. FFmpeg is a development-only
dependency, not part of the browser bundle.

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

- **BAM! / PING! / KRAK!** mark damaging hits; bloomstick and laser hits use **ZAP!**.
- **BOOM!** marks exploding interceptors, eye drones, scramblers and ship components.
- Scavengers retain the VS screen's stepped toon shading throughout gameplay.
  QuadShell spider bots outside the facility use the same shading. The winding
  stone trail has black edge outlines, including its culled instance batches.
  Eye drones carry a subtle blue emissive tint matching ballistic breakable blocks,
  while retaining their textures and existing warning-light colours.
  Ordinary opaque environment materials throughout the game use the crew cabins'
  lit cel shading, cool blue-purple shadows and subtle black structural ink
  edges. Characters, enemies, vehicles, screens and custom shader effects retain
  their existing styles. Newly added environment props receive the same treatment
  before rendering. Brondon's animated silhouette has a stronger two-pixel outline.
  Shared cel and outline GLSL lives under `src/shaders/frag` and `src/shaders/vert`,
  imported by `src/core/comicShading.ts`.
  **Display > Comic Look** toggles the environment's cel lighting and a restrained
  contrast/saturation boost. **Display > Outlines** independently toggles black
  structural and character outlines without changing the lighting.
  Both settings default to off on every page load and operate independently.
  Real lighting, shadows and material detail remain visible beneath the cel bands.
  The minigame stage, puzzle camera feeds and dedicated minigame views bypass this
  treatment and outlines, regardless of the Display preferences.
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
The green homing crystal shatters into falling, fading shards as Brondon finishes
materializing. Skipping the arrival also consumes it, and it stays spent on revisits.
Prime describes the living quarters as having no surveillance, without claiming
they are the ship's only surveillance-free area.

The prison's eye-opening canvas uses a close-up captured from Brondon's actual
cel-shaded model, preserving his magenta eyes, blond hair and angular brows.
Animated eyelid masks retain the flutter, blink and gradual opening.
The camera opens on the three-quarter view of his floating body instead of the
foot end, and returns to that angle after the eye-opening close-up.

Prime's compact comic textbox stays in the **top-left**, including during
flashbacks; memory and live-feed labels sit in the **bottom-left**. Click or
press **Space** to reveal a line immediately, then again to advance without
waiting for its camera shot. Timed narration can still advance automatically.
Hold **Enter** to skip the whole prologue.

The prologue's closing title and the museum wall use Scene 1's blue-to-red gradient
logo, menu font and framed **A tale of vengeance** subtitle instead of the old
yellow/red two-line lettering.

The lab memory first establishes the captive crew, then closes in on Brondon's
own pod. Prime's shield burst shatters its casing before experimentation can
begin; Donus subsequently imprisons Brondon in shield-suppressing chains.
The planet shot trails the actual mothership in third person, with the rescue
planet far ahead. A **ten-second security montage** establishes the escape
shuttle in **Hangar 14**, pans across the actual surveillance hub and its live
computer feeds, pulls back over the Deck One hangar patrols, flashes a
**0.75-second sinister Bay Warden close-up**, then closes on the hub's actual
camera-screen wall with animated footage. Hangar 14 appears only once, and each
main location gets over two seconds to read. The hangar, hub and camera wall
share their visual builders with gameplay.
The montage remains immediately skippable and does not repeat the boss reveal.

The chains sap Brondon's energy and prevent Prime from easily releasing his
shield. Prime has stored enough energy to break the chains with another shield burst
and will loop the prison camera feed to conceal the escape. Brondon's homing
beacon provides **one transfer to his cabin**. The crew cabins have no patrols:
recover the gear, then escape the ship. After "Brace for impact", the shield
breaks the chains, Brondon gets up, and the shorter title reveal leads to the
**Press E to start your revenge** prompt.

- The passage has **four cabins on each side**: Brondon, Branden, Brendan and
  Andre are unlocked; the other four student cabins are locked.
- Look at a nearby wall-mounted nameplate to display the room name automatically
  as comic-style subtext at the bottom of the screen. Nameplates show only the
  owner's name, with **no E prompt or key press**. The top-left HUD shows only the
  current room or area in a yellow comic caption with bold lettering and an
  outlined, offset-shadow panel.
- Doors, lockers and computers keep the **comic-styled E interaction prompts**.
  Inspection information temporarily hides interaction prompts and nameplate
  captions; they return when the information message clears.
  Interacting with a door is separate: unlocked doors play an automatic
  walk-through cinematic in either direction; locked doors report their occupant.
- The arrival dialogue follows the prologue: the homing beacon's one charge is
  spent, the prison camera is looped, and the escape ship is in Hangar 14.
  Prime asks Brondon to **look around the crew cabins for useful items** rather
  than listing their locations or pointing the camera at the loot.
  Individual cabins can be left freely. Only an attempt to leave the entire
  wing through the forward bulkhead gives **one hint for an item still missing**.
- Recover the **pistol from Brondon's chest**, the **teleporting crystal shard
  from Brendan's chest**, and **scanner goggles from Branden's chest** before
  leaving. Andre's bathroom locker is decorative and is not part of the
  cabin-equipment requirement; the working Bloomstick is recovered later in
  Stage Two.
- Every cabin shares a bed, correctly scaled desk/chair assets, a local computer
  with a blue desktop, file window, icons and taskbar,
  and a unique expedition poster. Andre's room also has an accessible locker.
  **N** toggles the goggles; tap **Q** to place a purple marker, or hold and
  release **Q** to throw the crystal. **T** teleports to its marker.
  **Hold Tab** selects weapons, not teleport destinations.
- Every communal-bathroom locker has actual internal shelves. Five lockers
  contain understated framed word pictures on those shelves, not above the
  showers or on the toilet wall.
  Read from Caleb, Husain, Andre, Sibusiso and Sohrab, their words form a
  deliberately subtle message: **YOU ARE A CHUMP BRONDON**.
- Cabin chairs are not interactable. Branden's and Brendan's computers offer
  inspection only. Trying to play Brondon's cabin computer instead
  earns a comic-style scolding from Prime: lock in and rescue the crew first.
  This also applies to developer visits and completed campaigns.
  Bathroom toilets retain sitting with **E / Relieve yourself at toilet**;
  press **E again** to stand. Toilets, surveillance workstations and the equipment archive share the
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
  Prime reads it out. Press **E again** or **Step back** to return to exploration.
- **Brondon's computer** shows a captured picture of the actual **Play / Don't
  Play** menu during an unfinished normal campaign. No iframe or
  embedded audio is loaded from this computer. Brondon cannot sit or play there.
- Use the **number panel beside the forward bulkhead** to zoom in. A glowing
  light pointer tracks the selected button without loading a hand model. Click the digits
  or use the number keys, then **OK / Enter**; **Backspace** erases and **CLR**
  clears. With a controller, the **D-pad** selects keypad buttons and the confirm
  button presses them; the right stick remains available as a pointer.
  Press **E again** (controller interact/back) to step away.
  Incorrect codes leave the door locked and display an error.
- Pressing **E** no longer queues the generic Interact gesture for doors,
  posters, computers or chests. Their existing actions and dedicated cinematics
  still run; chair sitting and standing keep their own animations.
- The correct code opens the bulkhead into the **opposite end of the Deck One
  patrol passage**. The transition prepares models and shaders before switching
  areas; failed loads keep the current area available with retry/cancel controls.
  The passage bulkhead can also return to the living quarters.
- The eye drone stays **completely stationary until Brondon reaches the passage
  midpoint**, then begins patrolling. Prime says, "Find a way around this drone."
  The storage door can be opened with **E**, but using it as cover is optional.
  Peeking and **B** quick-hide remain available from storage. The hangar
  checkpoint and the rest of Stage One continue as before.
- The hangar enforces crouching except for a **five-second Shift/RUN burst**.
  Releasing sprint recharges the circular **RUN** gauge to the right of **UNSEEN**.
  Three staggered cargo openings use different rows, roof boxes provide cover,
  and two dedicated eye drones patrol each long edge. All input modes retry the
  last checkpoint automatically after death. Control cards last twelve seconds
  and can be dismissed manually.
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
Sohrab's cabin includes a server rack matching those in the camera room, with
solid collision and space to move around the bed and workstation.
Their roster is maintained in [layout.ts](./src/scenes/living%20quarters/layout.ts). In development,
`?living-quarters` opens the area directly; the scene selector also has a
**Level 1 - Living quarters** entry.

### Room containment

The cargo hold, target range, prologue cell and museum's visually open skylight
have solid roof colliders. The cargo hold and target range live alongside the
other minigames in `src/scenes/level 1 stage 2/`. The player collider includes
standing head clearance and shortens when crouching, sliding or crawling through vents.
Standing up is blocked while overhead geometry is too low. Upward movement is
swept against roof boxes to prevent tunneling during strong impulses or slow
frames. Designed ladder hatches and vent routes remain open; outdoor areas and
scripted roof destruction retain their existing behavior. Unused legacy rooms are
unchanged.

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
- The larger surveillance room has **eight active wall screens in two rows of
  four**, furnished workstations and server racks. The top row is **prison,
  cargo hold, Bloomstick Tennis, Rust chamber 1**; the bottom row is **maze,
  target range, Reactor Sequencer, Rust chamber 2**.
  **Rust chamber 2 sits directly below Rust chamber 1** on the camera wall.
  There are no decorative wall-text plaques.
- Desk monitors play randomly chosen **looping GIF recordings of corridor bots**,
  not live 3D scenes or teleport targets. Only the camera wall's six unfinished
  minigame feeds allow travel. The prison and vent feeds are view-only.
  The hub has **15 workstations**, with additional stations along the side and
  rear walls; the hangar-airlock approach is clear of desks and server racks.
  After the vent drop, Prime remarks: "Security seems kind of lacklustre.
  I wonder what's going on."
- There is no guard or takedown gate in the camera hub. After landing and
  Prime's security remark, open the **camera-room crowbar chest** and go
  straight to the camera minigames and keycard elevator.
- Look at a feed and press **E** to visit its minigame; **R** always returns to
  the camera room. The small return control stays at the top of the screen
  without a persistent controls panel. **Q** places or throws the crystal and
  **T** teleports to its marker within the minigame; neither replaces the room
  return. A marker in a different room cannot be used to bypass this separation.
  No home-marker setup is required. The other decks have **no walking route**
  from surveillance. The cleared prison and vent feeds remain view-only.
  R always arrives below the green ceiling crystal; it never returns to the
  cabins. The initial green transfer from the prison to Brondon's cabin is
  single-use. Purple Q/T transfers and green R returns keep distinct hologram
  colours, including in Bay 13.
- Each existing minigame awards an **asset-backed keycard from its chest**:
  clear the cargo stack with the crowbar, solve the range's letter-order puzzle, or recover
  win Bloomstick Tennis. Cargo healing and range shielding remain bonus equipment,
  never prerequisites for collecting a card at full health/shield.
- **Bloomstick Tennis** (the batting cage replacing the equipment archive feed): Prime
  greets you with "The students would always play in here." Take the **working
  bloomstick** from the wall rack (beside a tennis racket), equip it, and stand on a
  lane plate. Each lane fires from a wall screen behind a **force field** that ripples
  when a parried shot hits it; an **LED scoreboard** above tracks every lane.
  **Centre Court** fires harmless tennis balls; **Deck Gunnery** fires bolts (10 HP,
  dodge or parry); **No Man's Land** fires fused bombs that must be parried (25 HP
  blast even if you dodge). Land **5 in a row per lane**, or return a shot
  directly into its firing hole to clear that lane immediately; any miss shows **YOU LOSE**
  and resets that lane to 0. Clearing all three unlocks the keycard chest. A table
  opposite holds two health packs and two shields; the front door is locked and a
  rules poster hangs above the chest. The pickup table has solid collision.
  R returns to the hub.
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
  suspended orange lock with the crowbar or bloomstick. Stair and gantry
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
- **Rust chamber 2**, imported from `rust-2-electric-boogaloo`, is a rust room
  whose two metal deck sections split apart. Its jagged edges are flat,
  walkable rust decking with matching polygon colliders, not loose rock blocks.
  The walls share the first chamber's corroded panel finish. The ceiling is
  lowered from 14 m to 8.4 m, with a visible overhead support, pivot, cable,
  lifting eye and release cradle for the counterweight.
  Brown rust water fills the gap; falling in uses the same melt-and-respawn
  treatment without clearing releases. Both chambers use opaque, subdivided
  water with animated ripple normals rather than a transparent acid sheet.
  Water rims and the torn deck sides use textured corrosion, with rust-stained
  top borders rather than plain grey edges. Orange wall fixtures and six warm
  wall lights brighten the second chamber without adding shadow-casting lights.
  The **directional trampoline** has a woven fabric mat, tubular metal frame, 36
  visible coil springs and braced support legs. The middle of the mat flexes
  down and rebounds while its edges remain attached to the frame. Its collider
  stays stable during visual rebounds, and reduced-motion settings suppress
  the deformation. There are no floating direction arrows.
  Bank a thrown crystal off the trampoline and press **T** after its marker lands.
  The covered release button is centered at the far end. Break its orange
  corrosion, press **E**, then shoot the swinging blue link so the counterweight
  lands on the trampoline and launches across. The suspension and load use the shared
  120 Hz physics clock. A launched load lands upright instead of cartwheeling.
  **E** picks up or puts down the load. Carrying allows normal mouse/controller
  look and camera-relative movement at 60% walking speed, but no sprinting,
  jumping or crystal use. Placement accepts the cube's overlap with the floor
  plate and seats it on the plate; it does not require an exact center point.
  Off-plate drops fall under gravity. The shootable direction beacon is centered
  on the wall above the rust water, visible from both decks. Each successful shot
  immediately switches the launch direction and changes both the beacon and mat
  to matching pink (far/east deck) or cyan (entrance/west deck), including the
  mat's glow and light. Rebuilding restores the pink eastbound state.
  Switch west, return, and collect the keycard behind the
  glass door. Completed plate/reward state persists across visits.
  A larger, high-contrast framed wall plaque pairs a short verse with numbered
  puzzle instructions and a direction-colour key. The opposite-side exit stays
  locked. Releasing the load and opening the reward doors have short cutscenes.
  Loose decorative blocks and the automatic puzzle walkthrough have been removed.
- Destructibles consistently use **blue glowing corrosion for pistol targets**
  and **orange for crowbar/bloomstick targets**, including cargo, wall targets
  and Bay Warden targets. These effects are always visible without goggles.
  Goggles enable the ASCII view and reveal the range's hidden letter labels;
  they do not recolour or boost destructibles.
  Camera-room desks face their chairs; seating aligns the animated character's
  lower-body contact surface with the actual chair cushion.
- Try the latest card at the elevator with **E**. Earlier cards are rejected;
  the **last of the seven collected cards** is valid, regardless of minigame order.
  Revisited rooms do not generate duplicate cards. Swiping the final card starts
  the walk-in and elevator cinematic immediately. Prime explains that Hangar 14
  is blocked and the route must pass through Bay 13.
  There is no password or hidden keypad.
- The hangar airlock is permanently sealed from both sides. The only route to
  surveillance is the ceiling-vent route; all minigame exit doors respond to
  **E** with a locked message and the **R** return instruction.
  Developer jumps to any camera minigame also enable the surveillance checkpoint,
  so **R** returns immediately without a manual setup. **T** remains the local
  crystal-marker action.
  On the ship map it sits **directly below the upper vents**; the quarters,
  passage, hangar and airlock align, but the sealed airlock never appears as
  a traversable connection. The hangar's locked far door is centred, and its
  map includes the staggered crawl openings and rooftop cover.
  Elevators show translucent shafts,
  landing platforms and available/offline stops, rather than a plain line.
  Camera-only minigames appear as separate surveilled-deck charts with purple
  dashed links, **never as stops on the elevator route**.
  Cargo Hold and Target Range share **Branden's deck**; both Rust chambers share
  **Brendan's deck**; Bloomstick Tennis and Reactor Sequencer share the
  **students' deck**. Their deck filters and chart heights match this ownership.
  The hub chart includes its central chest, eight camera screens and green
  return crystal. **Left stick** pans, **right stick** rotates, and the
  **left/right triggers** zoom out/in while gameplay stays paused.
  **Shoulder buttons** cycle decks; the left face button locates Brondon and
  the top face button resets the view. **D-pad** navigation and the normal
  Confirm/Back buttons still operate the map buttons. Hints follow the selected
  controller profile, including custom layouts.
- Silent takedowns have a shared articulated shutdown animation. During the
  short cutscene other bots pause. **E takedown takes priority over a nearby
  ladder or fault relay**. The original roof drones sweep every 14 seconds;
  dedicated amber-lit perimeter eyes make the long-edge surveillance visible.
  The hallway eye drone has a real searchlight and matching visible cone.
  Eye drones can be shut down by a precise **pistol shot from directly behind**;
  shooting their front armour alerts security instead.
- The prologue's chains and cuffs use the same animated blue hologram shader as
  its holographic figures.
- Scenes **2, 3, 4, 7, 8, 9, 10, 11 and 12** remain as source files, but are no
  longer imported, preloaded, routed or offered in the active developer menu.
  The camera rooms use lightweight crew chests rather than the old model chest.
  All chests use a light-grey exterior to stand out against dark decks; model
  chests retain their normal and metallic/roughness maps without the dark colour atlas.

Developer Mode includes the surveillance route, archive and camera-room previews.
In development, `?stage2-infiltration` starts at the vent entrance;
`?stage2-hub` starts at the camera-room checkpoint with cameras and minigames ready.
Both provide the earlier cabin equipment; the crowbar and bloomstick are still
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
- In phase four, teleporting behind the Warden confuses him for **3.5 seconds**:
  **???** appears above his head, he holds his facing and stops launching attacks,
  and the blue back target remains vulnerable. Afterwards he repeats his opening
  scan before resuming attacks. Existing drones and lasers remain dangerous.
- The phase-three return walk blends into Donus's takeover. A head-anchored
  **DONUS // OVERRIDE** terminal shows progress and **CONTROL SEIZED** instead
  of surrounding the possessed bot with energy rings.
- Teleporting behind the phase-four bot starts a low-gravity finishing QTE:
  **Y** shoots the rear core, which uses the blue ballistic-breakable shader;
  **U** jumps onto the fallen bot; **I** bisects it. Each prompt allows five
  seconds and uses the existing controller button mappings or a touch button.
  It shares the hangar's letter-prompt styling. Throwing and teleporting unlock
  only after **five seconds from the Warden's first barrage shot**, not from
  the start of his scan. Prime says **"We need to get behind him."** before
  the **Hold Q + left-click** and **Press T** instructions appear.
  Camera shots follow the aim, core impact, fall, jump and cutting stroke,
  with continuous arcs, dollies and restrained Dutch angles during input windows.
  Brondon floats beside the wall with loose, drifting limbs and his revolver ready.
  Arrival uses his normal idle animation, with no shield. Prime's subdued cyan
  shield appears only on **U**, propelling him off the wall toward the fallen bot
  without a bloom boost; the firing shot tracks just behind the barrel.
  The jump tucks into a three-point landing with impact sound and camera recoil.
  There are no clank effects during the finisher or its defeat handoff.
  An expanding slash wave, glowing split edges, sparks, chromatic separation,
  the finale's blade trail and a short impact pause intensify the final cut.
- The cut flows into Brondon leaping across the split bot while the camera pans
  to Branden emerging crouched on Brendan's authored
  rig, explains the neural experiments, and saves Brondon when Donus detonates
  the fallen halves. The camera cuts to a full-screen, in-scene close-up of
  Branden's face for **2.2 seconds**, then cuts back as he moves to save Brondon.
  There is no comic strip or separate portrait overlay. Brondon shouts **"Brandennnn!!"**
  as the explosion goes off. Both remain close to the wreck: Branden makes contact
  before shoving Brondon clear, and the directed fire engulfs Branden during
  the push. There is no Prime shield. Brondon lands and runs back to Branden,
  then kneels as Branden pleads: **"Save the students... They're the future of our
  research. Don't make it meaningless... I beg you."** Brondon promises before
  Branden dissolves in red. Only after the dissolve finishes, Brondon says
  **"I will avenge you."**
  Control resumes at the death spot; there is no scripted walk or teleport to
  the console. The lift remains available for its existing interaction and descent.

## Level 2 matchup, targeting and firing

- Scene 14's hangar matchup reads **BRONDON VS SCAVENGER SWARM**.
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
(dodge) and **O** (bloomstick spin). The running shot and skeletal animation
continue in slow motion while a prompt is visible. A timely input smoothly
restores motion; a missed input blends into the death shot from the current
position. Both cinematic strikes and ordinary melee hits show comic impact
words, including crowbar and bloomstick fights.

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
Pines retain their full needle sprays and woody branches nearby. Distant pines
use fewer needle cards, not solid cone-shaped canopies. Trees, source groves and
grass are instanced in small spatial batches and culled against the active
camera's frustum and distance; off-screen foliage does not cast extra shadows.
Collision streaming remains independent, so unseen trees and obstacles stay solid
when needed for gameplay.

Grass stays clear of the stone paths, bridge deck and approaches, with clearance
for the tuft width and wind movement. It retains the lower-density layout and
fades before its 40 m render cutoff. Foliage textures use mipmaps and limited
anisotropy. Nearby pines occasionally shed small falling pinecones from a fixed
pool; off-screen pinecones are hidden rather than submitted for rendering.

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
from the dinosaurs off the route. Normal Scavengers patrol before the intact
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
bloomstick-parried beams. The exterior has no photograph or sign above its door
in the landing, jungle or finale. The group-photo reveal remains inside; the
former exterior-photo discovery cutscene has been removed.
The facility door opens as the player approaches. Both directions between
Scenes 17 and 20 use the standard chapter-loading flow and shared sliding-portal
handoff: position, velocity, facing, held inputs and health carry across the
matching doorway frames. Walking back out returns to the exterior entrance,
not the landing checkpoint. There is no scripted six-metre walk or entry-camera
blend. Preparation failures retain the standard retry screen.
Prime says, "I expected more security."

The exterior has a hostile villain-lair silhouette: a dark hemispherical dome
with crimson energy bands, round windows and four pillars supporting the
rectangular roof battle deck. Inside, the bright teal/white laboratory palette
is retained, with furniture fitted to the dome footprint and the reveal picture
still on the wall. The four-station puzzle remains in the separate
Reactor Sequencer camera room; Scene 20 keeps its open atrium and central
staircase to the office. The mezzanine follows the dome's curve, with matching
floor collision and balcony guards. Eight workstations, rear archives and
upper perimeter cabinets make use of the round footprint without obstructing
the central stairs or the students' table.
Workstations use the same authored desk and chair models as the cabins, grounded
and uniformly scaled, with matching rotated colliders and monitors on the desktops.
The eight monitors retain the original FLA site screenshot, so walking
through the facility creates no live web pages. Face a monitor and press **E**
to sit at its chair. Once Brondon finishes sitting, that monitor alone changes
to the live depth-occluded CSS3D page; clicking the page follows its external
site URL. Use **Close screen** or **E** to leave; the iframe is unloaded and
the screenshot returns. Wall displays and windows never load the website.
The supplied SDP/Gitea capture is instead on Brendan's cabin computer; clicking
anywhere on that page displays its 503 response.
The wall screens instead show the supplied **SUDOERS HIDEOUT** photo with an
ink-bordered yellow title strip. The high entrance window clears the doorway;
round windows have recessed panes and raised metal rims below the mezzanine.
On entry, comic dialogue panels show Brondon saying, "This looks more like a
resort than a prison," followed by Prime's "Could it be...?"
From Scene 17, the open doorway shows an unlit black aperture until the player
crosses into Scene 20.
The arrival is an in-engine cutscene: Prime remarks that the facility looks
more like a resort than a prison. Brondon walks around the stairs and furniture
to the Sudoers Hideout picture, with eased movement and continuous camera framing,
then says he needs to confront the students face to face. Its **Hold Enter to
skip** control sits in the top-right corner.

The stairs have illuminated tread edges, structural stringers and sloped glass
railings. Only the upstairs holographic lab fit-out from `earth` (`1c28dc6`) is
imported: framed circuit panels, blueprint display, touch consoles, ceiling beams
and cyan lighting. The five original Subject models and their conference table
sit in the open middle of the top-floor room, using their authored sitting
animations. Glass panels run along the balcony edge, not around a smaller inner
office. Climb the centre stairs, approach the glass door at the landing and
press **E** to peek.
The camera eases toward the glass; the five notice Brondon and turn toward him,
then the scene ends and the finale begins. Merely reaching the upper floor does
not end the scene. Stairwell power stays unlocked on a round trip outside.

The dome, windows, entrance and four-pillar roof deck share one architecture
definition across the landing, exterior, interior and finale.
During the final reveal, the students stand from their chairs and laser a
circular cut into the dome. Only the cut cap is removed; the dome remains.
Brondon and all five students ride the lift from the 4.2 m office floor to the
24.4 m battle deck by 4.8 seconds. Mech assembly starts at 4.95 seconds, after
everyone reaches the platform.

## Scene 21: Final boss

Stage One's first Deck One entry and the initial final-boss entry use cinematic
loading screens with a randomly selected destination screenshot and gameplay tip.
They remain visible for at least **three seconds**, and longer when assets are
still loading. Returning to storage, retrying a boss checkpoint and all other
scene transitions retain their existing seamless handoffs. Entering Scenes
13, 14, 15 and 16 shows the same short **CHECKPOINT SAVED** banner as Stage One.

Scene 20's observation-deck reveal leads into the Sudoers 5 finale. Each student
gets an individual close-up while the group admits that they hacked Donus,
experimented on Branden and Brendan through the warden and simulations, planted
the false laboratory rescue in Prime's memory, and designed every step of
Brondon's journey. Brondon confronts them over his friends' deaths and rejects
their justification. The students' seated skin contact and leg length determine
their cushion alignment; ceiling spotlights are wider, softer and less intense.
Speaker close-ups use eased camera transitions. The roof
blows clear, the students enter their mech one at a time, and the shuttle recalls
from its Scene 17 jungle parking spot to morph into **Opus**. Brondon answers,
"I taught you everything you know. But not everything I know," before Prime
calls the ship and deploys Opus. A comic VS
screen introduces the fight; there are no generated platforms under the mechs.
After the transformations, dusk deepens into a moonlit, starry nighttime rooftop.
Both combat frames use `mechs.glb` armour bound to independent copies of the
Subject combat rig, with articulated hands and weapon grips. Only Final Verdict
has wrist bridges to fill its hand gaps.
Opus retains its original forearm and wrist-crossing armour faces; only
the original hand geometry beyond the wrist is removed, with no added filler.
Using the same rig avoids twisting the hero armour around MC's different bind
pose; combat clips are selected for the actual rig. Opus uses cream/pink armour
(`platelight` **#DCC8BF**, `platemid` **#B89494**, `plateshad` **#755967**),
a grey inner frame and pink/red gems. Final Verdict uses deep-purple armour,
near-black frame parts and lime/emerald gems (`gemlight` **#D3FF6D**,
`gemmid` **#5C9A54**, `gemdark` **#1A3727**) instead of the previous red finish.
Both preserve the asset's material regions instead of replacing them with
the procedural industrial armour shader. Their swords, rifles and
scabbards follow their armour palette. Assembly, fading slash marks and the final
dissolve remain available without replacing the model's surface materials.
The original armour's hand-end geometry is trimmed at the wrists so it cannot
overlap the articulated replacement hands. Both frames use Brondon's two-tone
shadow shading, retaining their separate palettes and Final Verdict's soft violet glow.
Replacement hands and wrist bridges share their frame's light armour colour;
energy effects use Opus's pink and Final Verdict's violet colours. Only Final
Verdict's three gem materials use lime/emerald greens.

Use **A / D** to move and **J** to swing the reactor blade. The free Standard
animations retain their complete anticipation, contact and recovery at their
authored playback speed. Blade afterimages fade in **0.085 seconds**, with softer, narrower
trails and restrained charge glow and impact sparks. Damage follows the animated blade sweep; luminous cuts remain on damaged
armor for **1.65 seconds** before fading. **F** sheaths the sword, draws the
back-mounted rifle and fires a two-handed salvo. **Hold R** for a draining shield
or timed parry, **Space** performs a dodge boost with **no energy cost or recharge**,
and **C** slide-tackles the Final Verdict and knocks it down briefly on a clean hit.
Boosts can also cancel a committed move once its cinematic close-up is over.
The rooftop fighting bounds are subtly wider; the facility perimeter and its
colliders extend to the enlarged deck edges as well. **E** charges **Brendan's Will**, then
releases a flying blade flash; it starts ready and recharges in **18 seconds** of
combat time. **W / S** control altitude in space. Shielded hits are fully absorbed,
including the hit that breaks the shield. Blocking recoils melee attackers and
deflects projectiles; a timed parry reflects them toward Sudoers 5.

Sudoers 5 jumps forward into its thrust, uses a reverse diagonal cut, and leaps
backward before charging its sword-tip beam, whose deep red matches its armor glow.
In orbit it also uses **Eclipse**, a sword rush with its own cinematic tell
and a dodge/parry window. The jumps move the actual combat
body in both rooftop and orbital fights. Recovery reminders, adaptive exploration
hints and introductory control cards are disabled during the finale; attack tells
and resource warnings remain during combat. Special-move close-ups return to the
normal camera **at least 0.55 seconds before firing**. Both fighters are protected
from unrelated attacks during the introductory close-up; dodge or guard when
gameplay resumes. Release R to recharge the shield.
The boss health bar is centred along the top edge, Brondon's life sits at the
bottom-right, and circular comic controls ring the remaining edges. Rifle energy,
shield recovery and Brendan's Will recharge directly around their **F**, **R** and
**E** buttons and change to **READY** when available. Shielding uses an open,
extended off-hand stance instead of the pushing animation;
the sphere follows the center of the fighter. Orbital locomotion blends a
momentum-driven flight stance with the same original attack animations as on the roof.

The facility's centre contains a softly lit silver-and-mint floating core on its
dais, sharing its shell and three orbital bands with the planet breaker.
Before the orbital phase, the enemy poses, jumps back and raises both hands.
The camera cuts inside the facility as the core dematerializes in a pixel breakup,
then cuts back to show it rematerializing above the hands and arming red.
The enemy launches it skyward and commands its descent. The camera
follows the meteor into Earth, then immediately cuts to Brendan's `DonfromStreets.glb` actor
in the burning rescue forest. A dedicated close-up tracks his head, with the
volumetric fire shader attached to the head bone and progressive surface scorching.
Brendan cries, "Ahhhhh, it burns!" The camera returns to a full view of Earth
engulfed in animated solar fire, holds it for **2.8 seconds**, then shows the planet
bursting into stardust with a large **BOOM!** using the shared comic impact artwork.
The fire surface breaks apart as the dust expands, exposing the nebula and stars
where Earth used to be. Inside Opus's cockpit, Brondon answers,
"Nooooo, Brendan!!" and tells the Sudoers, "Sudoers, I will never forgive you.
You must die. I will have my revenge!!!" Before the escape, the students declare, "You haven't seen
the extent of our ambition." Prime announces emergency thrusters and atmospheric
escape; the bomb has no named special-move callout.
As the camera pulls out from Brondon's cockpit-face close-up, a **7.2-second
Opus Magnum power-up cinematic** begins during that same transition and keeps the duel paused:
Brondon uses Quaternius's **Sword_Idle** animation, keeps his sword in hand,
and shouts **"AHHHHHH!"** with a locally synthesized voice while charging inside
a rising golden flame aura. His armour
plate materials transition to **platelight `#FFE639FF`**, **platemid `#E79937FF`** and
**plateshad `#9D5700FF`**, with purple gems (`#B202B4`, `#701199`, `#5F0B65`)
and matching gold/purple sword detailing;
the rifle also turns gold and remains holstered during the pose. The orbital
fight resumes after the golden aura fades away completely. The gold armour and
purple gems persist through the rest of the finale and space/finisher checkpoint
retries. The mech shield is white before this transformation and yellow afterward,
independently of the aura. Brondon's personal Prime shield, shield HUD and shield-hit
feedback are yellow throughout the game. Enemy and ship shields are unchanged. Reduced
motion disables the aura's flutter and rising particles and removes the impact
shake. The collapse soundtrack continues through the power-up.
The final fight uses the shared baked-nebula starfield, fading in over the
nighttime rooftop and remaining behind the orbital duel and ending. The
background follows the camera and its stars stay beyond the actors and planet.
The destruction uses **one 1,600-point GPU-animated stardust draw** and at most
**48 instanced rocks**, ejected from Earth's surface only during the burst.
Rocks fade within **2.8 seconds**, and dust clears before the cockpit reaction;
there is no permanent, randomly orbiting rubble during combat or the epilogue.
The nebula is baked once during preparation, not regenerated each frame.
The space sky, planet destruction, burning-head shot and cockpit resources share
the finale's single preparation pass. Orbital fog is disabled
through its distance uniforms rather than switching shader variants, and rooftop
shadows stop updating without changing the light's shader configuration.
The sequence cuts between locations instead of flying the camera through terrain.
Its eased, curved pullback starts at the actual cockpit camera; the cockpit fades
out as Opus is revealed, with both mechs in airborne fighting stances before
the orbital duel resumes. Music continues without restarting. The bomb begins
its descent at the apex rather than pausing there.

The final execution is an **input-independent cinematic**. There are
no prompts, grades, input pauses or missed-command deaths; future QTE overlays can
follow the film clock without controlling it. The students open with "Our ambition
knows no limits." Brondon replies, "Neither does my vengeance." Each has a
full-body power-pose shot before Brondon evades Final Verdict,
parries a second attack, returns rifle fire, locks blades, cuts through, ascends
and charges his final attack, saying "I will end this." The extended clash cuts from sparking steel to Opus's
face and Final Verdict's face. The following slash is framed just behind Prime's
sword shoulder. The students' final slash is **Final Verdict**; Brondon's
vanishing rush reappears behind them for **Brondon's Revenge**, followed by forty
staggered slash accents, with a physical recoil for every hit and an authored
death pose. Root trajectories preserve momentum across cuts. Blade-contact IK
keeps the bevelled sword surfaces separated instead of passing through each other;
combat shields are not carried into the execution.

Planet impact dissolves the textured crust and clouds, revealing an opaque,
animated solar-fire surface. In the clearing, Brendan uses his authored
`Fixing_Kneeling` entry, then `Death01`, with the standing anticipation trimmed to
match the kneeling hip height. Head fire follows the actual head bone throughout
the fall. The burning-Earth and stardust shots finish before the cockpit cut.

After the final strike, Brondon remains in **Opus**, crouched and bowed in space.
A low-angle shot looks up at the ghostlike figures of Branden and Brendan above
him. He apologises for not saving them and admits that vengeance is all he has
left; this is not presented as justice or celebration. There is no dance,
human-on-foot tableau, generated deck, or Donus fly-in. The narrative ends here;
the later credits cast is a separate, non-narrative curtain call.
Centered credits run in **90 seconds**, with Brondon, Branden, Brendan and the
five students dancing fully solid along the side margins. These
performers clone the finale's already-loaded characters and share cached
geometry, textures and animation clips; no new model downloads, sprite baking,
or additional WebGL context are needed. The copies are prepared during the
victory epilogue, outside the initial loading screen. Reduced motion freezes
dancing and removes the side performers' drifting movement.
After the text clears, all eight walk in from the screen edges over **five
seconds** into one responsive row, ordered left to right: Brondon, Branden,
Brendan, then the five Sudoers. A party-game-style results celebration follows
for **five seconds**: winner Brondon stands and dances, Branden and Brendan
kneel and hold, and the five Sudoers fall down and remain defeated. These
reactions reuse the cached dance, kneeling and fall animations.
When the curtain call finishes, the finale is disposed and the game returns to the
actual main-menu scene, preserving the campaign-completion unlock.
A visible **hold Enter to skip** control
skips the boss introduction; the same control skips the ending dialogue in
Scenes 13 and 16 without losing their unlocks or scene handoff. Scene 1 ends
directly on **Play / Don't Play**, with no opening credits roll.
Scene 1 has a small **View Credits** button in the bottom-right corner of its menu.
**View Credits** is also available in the pause and developer menus. Its scrollable
credits sheet and the rolling credits use the game's comic typography, halftone
paper panels, ink outlines, offset shadows and coloured caption badges.
The credits sheet shares the end roll's attribution list: creation and story by
**CHASS**; music by **Caleb**, produced in **GarageBand for iOS**; Brondon and
DonfromStreets (Brendan) character models and the mech model by **Husain**;
generic character models from **Quaternius's Universal Animation Library
(UAL)**; and weapons (including the pistol and rifle) and enemy robots from
**Quaternius's Sci-Fi Essentials Kit** (**CC0 1.0**). It also credits animation
authors, engine/physics libraries and development tools. Unconfirmed asset
sources remain explicitly marked for verification rather than assigned to an
author.

The shuttle recall preserves its parked world transform, lifts clear of the ground
before forward flight, then follows a curved approach to Brondon.
Signature moves display **Branden's Tears** (rifle), **Brendan's Will** (slash),
**Rebel** and **Eclipse** during their cinematic wind-ups, using the Sefa font
and a higher screen position. **Final Verdict** names the students' final
execution slash; **Brondon's Revenge** names Brondon's teleporting counterattack.
The combat buttons use the short labels **TEARS** and **WILL**; cinematic
callouts and control-reference entries retain the full move names.
Mech clips are retained between frames instead of being stopped and restarted.
Cinematic poses blend across attacks with controlled guard, weight transfer and ascent;
damage reactions retain their sampled motion and momentum.

Combat animation assets are taken from the downloaded, free **Quaternius Universal
Animation Library 1 and 2 Standard packs**, under CC0. All seven supplied sword
attacks are baked onto the MC and Subject bind poses; matching bone names alone
are not treated as matching bone axes. Only animation tracks are included, not
the packs' demo meshes or paid Source assets. The runtime caches the baked library
before gameplay and does not retarget or bake it on each swing.

For **keyboard and mouse bloomstick combat**, left click chooses a random
authored cut, lunge or regular combo, avoiding consecutive repeats. **Three clicks
within 450 milliseconds** queue the heavy combo. The current swing finishes
before the heavy combo begins; rapid input does not restart or abruptly cut an
animation. Movement keys no longer select mouse-click attacks.

Controller/touch bloomstick attacks and the **final-boss sword** retain these
direction mappings. Attack means the controller/touch attack button for the
bloomstick, or **J** in the finale. Directions are captured when attacking,
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
two-handed pistol (with recoil), and bloomstick, with idle fists when unarmed.
They appear both when toggling to first person and when a wall forces the
shoulder camera into first person, then disappear when shoulder clearance returns.
The hands render in a separate depth-cleared view so nearby walls do not clip
the held weapon; pistol muzzle effects remain aligned with the grip, and melee
damage continues to use the gameplay attack paths rather than the overlay.
The third-person revolver is fitted to the character's hand size and seated
between the right hand's curled fingers. The cylinder sits above the grip,
clear of the fingers, while the authored left hand supports the hold. Muzzle
effects follow the resized gun; first-person weapon placement is unchanged.
Bloomstick first-person presentation follows the animated hand and blade, not a
separate generic swing arc. Gameplay bloomstick clips play at **1.6x speed** with
**70-millisecond attack blends**; both camera modes share the same scaled animation,
cooldown and contact-window timing. A **360-millisecond parry window** opens on
the initial click and each combo contact, with a **200-millisecond perfect window**.
This makes approaching beams easier to reflect without speeding up the finale
or damaging targets during recovery/idle poses. Separate combo strokes
can hit a target once each, and holstering cancels pending swings and parries.

In the finale, **J** always swings the reactor blade. **C** uses the imported
grounded slide start, carry and exit, with sampled foot contact rather than sword
reach; a clean tackle knocks the boss down for **1.8 seconds**. Sword Block supplies the guarded
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
Every developer scene entry, checkpoint return and direct development URL grants
the pistol, crowbar, fully powered Bloomstick, scanner goggles and teleporting
crystal. The Bloomstick has no beamless variant. Developer surveillance visits
can start the Bay 13 elevator with **E** without collecting minigame keycards;
the preview still approaches the reader and swipes a card before opening the
door and walking into the elevator. This bypass does not mark the minigames
completed. Entry and exit movement face the actual walking direction, with a
smooth camera handoff. Prime identifies the mining robot as Branden's design.
Orange perimeter strip lights
and lamps are removed in all modes; patrols and detection remain active.
Prime's stealth guidance is to find a way around the drone, not to hide in the
storage room. Loading-screen Field Notes contain neutral controls and comfort
tips, not puzzle solutions or story spoilers.
Green and red Scrambler views retain their phase-specific ship size; perspective
flight scaling no longer shrinks the ship in those views. Capital/Scrambler
shields use ordinary selective bloom without increasing the firing pulse.
In the Vite development build, press **=** to enter a paused free-fly camera for
capturing loading-screen views. Use **WASD** to move, **Space / C** to rise or
descend, hold **Shift** for fast flight, drag to look, and press **=** or
**Escape** to restore the gameplay camera.
The final-boss shortcuts include **Bomb release / 50% health**, which starts at
the exact bomb-release frame with **900 / 1800** enemy health, and **Final cinematic
start**, which starts the execution at time zero. Loading warm-up does not advance
either checkpoint's timeline. **Epilogue - Rolling credits** jumps straight to
the actual end credits, with the same music, 90-second text roll and ten-second
cast curtain call
as a completed game; it does not replay the boss fight.
Shielding keeps the mech's head facing forward;
its normal opponent-tracking remains separate from the guard's torso/arm pose.

## Earth visuals

The jungle vegetation includes the photographed bark, taller pines, proportional
branching and revised needle/grass colours from main. Bark follows the same
pre-baked, gzipped RGBA loading approach as Earth: **1024 x 1024 colour** and
**512 x 512 normals**, cached once and shared by per-scene texture handles.
Lossless row-delta filtering improves compression of the resized pixels.
The base GPU pixel footprint is **5 MiB instead of 20 MiB**, with mipmaps and
normal-map colour space preserved. Regenerate the packed asset with
**`npm run textures:bark`**. Original photographs remain as build inputs; only
the packed binary is imported into the game and its asset preload list.

The shared [Earth renderer](./src/scripts/global/earthTexture.ts), brought over from the
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
      scene1.ts             Main Menu and first-load opening cutscene
      prologue/             Prison awakening and security/stealth previews
      living quarters/      Shared habitat scene with lazy cabin interiors
      legacy scenes/        Unused original rooms
      level 1 stage 1/      Storage room and stealth hangar
      level 1 stage 2/      Surveillance hub and all active minigames
      level 1 boss stage/   Scenes 13–14
      level 2/              Scenes 15, 15.5 (scene15-5.ts), and 16
      level 3/              Continuous approach 17, facility 20 and final boss 21
    scripts/
      global/               Shared gameplay and cinematic helpers, including holdToSkip
      player/               Player controller, character animation, posed limbs and slide tackle
      npc/                  NPC behavior and shared knockdown animation
      items/                Item model factories
      weapons/              Weapon controllers and selection
      level-2/              Flight helpers
      level-3/              Facility, jungle and finale helpers
      museum/               Museum display helpers
      prologue/             Containment pod helpers
    shaders/
      vert/                 Vertex GLSL, including ascii/
      frag/                 Fragment GLSL and player cel-shading chunks, including ascii/
      waterNoise.glsl        Shared water noise
      mountainRock.glsl      Shared rock surface functions
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
The landing, playable exterior and finale share the pine and grass builders.
The finale uses spatially culled foliage batches and reduced distant needle
sprays rather than rebuilding the full traversal level. Its roof blast still
removes every visible part of an affected tree.
The reveal and each student's close-up share one dialogue timeline. After the
roof shatters, the five students ascend one at a time and merge into the enemy's
chest through subdued crimson beams and a dark energy aura. The actual shuttle lifts off from its jungle
parking spot, flies to Brondon, disassembles, and morphs into Opus. A comic
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
Victory credits keep their text centered between fully solid, cached 3D cast
dancers, followed by a single-row winner-and-defeated results celebration.
Brondon's cockpit close-ups use the same character model as on-foot gameplay;
Opus retains its existing mech model.
The epilogue keeps Opus crouched in space below Branden and Brendan's apparitions.
The 90-second text roll is followed by the cast's ten-second walk-in and pose
before returning to the main menu.

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

## Tech Stack

- **Three.js** -- 3D rendering
- **TypeScript** -- Type safety
- **Vite** -- Dev server and bundler
