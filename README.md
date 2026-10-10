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

## Keyboard and controller input

Keyboard and mouse are the default on every page load. Plug in a two-stick
Switch / NES-themed, Xbox or PlayStation controller, press any controller button,
then open **M > Controls > Controller** and **pick your controller type**.
Selecting a type enables controller input when its browser layout is ready.
Connecting a controller alone never changes the input mode. The two Controls
tabs select the input and show the matching bindings.
The menu is available during the opening as well as gameplay.

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
| Toggle crouch / forward slide tackle | Y | X | Square |
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

The **final boss** uses left stick for movement and space altitude, A for the
sword chain, X for the rifle salvo, hold ZL for shield/parry, B for dodge boost,
and R for Last Light (the existing 18-second recharge). The mech has fixed
weapons rather than an inventory wheel. Hold - to skip the intro;
D-pad Left retries after defeat. Final QTEs display controller labels: D-pad Left to evade
the execution shot, A for sword cuts, X for return fire, B for boost,
**mash Y** for the blade lock, D-pad Up to ascend, and **hold R** to charge.
Real button taps are required for mash prompts; holding a button does not auto-mash.

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
takes over when the final credits begin. Weapon-wheel pauses do not start Menu.

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
actual scenes. The progress bar counts completed download/preparation jobs, not
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
rendering or device-related frame drop. A browser without usable AAC/M4A decoding
shows an audio-support warning rather than making the loading screen hang.

The developer menu uses descriptive level/stage names in story order, including
the capital-ship shield and exposed-reactor phases; internal scene numbers are
not shown as misleading level numbers.

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
  sensors and six checkpoint pads. Use **WASD / arrows** on the fullscreen map;
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
  computers and chairs**, plus server racks. Five wall feeds are active: cargo,
  target range, equipment archive, the **already-cleared vents**, and the
  **already-cleared prologue prison**. The other
  wall screens stay off. There are no decorative wall-text plaques.
- Desk monitors play randomly chosen **looping GIF recordings of corridor bots**,
  not live 3D scenes or teleport targets. Only the camera wall's three unfinished
  minigame feeds allow travel. The prison and vent feeds are view-only.
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
  clear the cargo stack with the crowbar, shoot every range target, or recover
  the archive footlocker. Cargo healing, range shielding and the archive
  lightsaber are retained as bonus equipment, never prerequisites for collecting
  a card at full health/shield.
- Try the latest card at the elevator with **E**. Earlier cards are rejected;
  the **last of the four collected cards** is valid, regardless of minigame order.
  Revisited rooms do not generate duplicate cards. Swipe the final card, then
  **walk into the elevator and press E on the Bay 13 button** for the intense
  button-press, flickering-light descent, heavy stomps and existing boss intro.
  There is no password or hidden keypad.
- The camera hub is physically connected to the hangar airlock on the **same
  deck**. After its guard is down, this door provides a return walking link.
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
transparent sheets, animated impact foam and spray. The stone trail stays safe
from the dinosaurs off the route. Normal Trilobites patrol before the intact
bridge, and spider bots patrol only beyond it.

River sharks swim below the surface with their fins barely showing. Falling
into the river starts a continuous shark-swarm scene before death and a return
to the landing checkpoint, rather than killing the player immediately.

The waterfall detour is optional. Going behind it shows a **VS** screen and
seals the arena for the hopping **Waterfall Warden** spider miniboss. Every
weapon remains available. Defeating it unseals the arena and reveals a chest
with an **Aegis Core**. Collecting that core grants one automatic **30-second
immunity** at the start of the final boss's playable combat. It survives
exterior/interior transitions; using it is recorded in the boss checkpoint
and cannot be refreshed by retrying.

Ship-styled facility sentinels can be destroyed with pistol fire or returned
lightsaber-parried beams. The facility door opens as the player approaches
and blends into Scene 20, where Prime says, "I expected more security."

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

Use **A / D** to move and **J** to chain a downward cut, side cut and heavy downward
finish. The original authored sword and special-move animations and their timings
are retained. Blade afterimages fade in **0.085 seconds**, with softer, narrower
trails and restrained charge glow and impact sparks. Damage follows the animated blade sweep; luminous cuts remain on damaged
armor for **1.65 seconds** before fading. **F** sheaths the sword, draws the
back-mounted rifle and fires a two-handed salvo. **Hold R** for a draining shield
or timed parry, and **Space** for a dodge boost with **no energy cost or recharge**.
Boosts can also cancel a committed move once its cinematic close-up is over.
The rooftop fighting bounds are subtly wider. **E** charges **Last Light**, then
releases a flying blade flash; it starts ready and recharges in **18 seconds** of
combat time. **W / S** control altitude in space. Shielded hits are fully absorbed,
including the hit that breaks the shield. Blocking recoils melee attackers and
deflects projectiles; a timed parry reflects them toward Sudoers 5.

Sudoers 5 jumps forward into its thrust, uses a reverse diagonal cut, and leaps
backward before charging its sword-tip beam, whose deep red matches its armor glow.
In orbit it also uses **Eclipse Rend**, a sword rush with its own cinematic tell
and a dodge/parry window. The jumps move the actual combat
body in both rooftop and orbital fights. Recovery reminders, adaptive exploration
hints and introductory control cards are disabled during the finale; QTE prompts,
attack tells and resource warnings remain. Special-move close-ups return to the
normal camera **at least 0.55 seconds before firing**. Both fighters are protected
from unrelated attacks during the introductory close-up; dodge or guard when
gameplay resumes. Release R to recharge the shield.
Shielding uses an open, extended off-hand stance instead of the pushing animation;
the sphere follows the center of the fighter. Orbital locomotion blends a
momentum-driven flight stance with the same original attack animations as on the roof.

Before the orbital phase, the enemy poses, jumps back, raises both hands, forms
the planet breaker, launches it skyward and commands its descent. The camera
follows the meteor into Earth, then shows the explosion with a large **BOOM!**
using the same starburst, halftone and ink artwork as other comic impact words.
The final surface transmission returns to the actual `boy.glb` actor in the
burning rescue forest, with a progressively charred appearance. A close-up inside Prime Frame's
cockpit shows Brondon's face: **"Noooooo! You killed Brendannnnn!"**, then
**"There is no forgiving you now. You will die."** The camera pulls back into
the orbital duel without restarting the music.

The final QTE runs on a continuous cinematic timeline, regardless of successful
or missed inputs. Root motion carries momentum across shots; prompts and brief
grades remain an overlay, with the blades brought into actual contact during
the lock. Time the tap prompts as the closing ring meets the target,
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
separate gameplay scenes. The finale reuses the rescue-site world above the
facility roof, with its intact bridge, western mountain and waterfall.
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
