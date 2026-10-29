# Recorded effects and ambience

These files are bundled locally, not streamed from their original hosts.
All recordings below are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
Creator credits also appear in the game's shared credits panel and finale roll.
Existing sounds outside this directory retain their existing credits.

| Bundled files | Creator / original collection | Original files |
| --- | --- | --- |
| `robot-step-{1,2,3}.ogg` | [Kenney / Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactMetal_light_{000,001,002}.ogg` |
| `mech-step-{1,2,3}.ogg` | Kenney / Impact Sounds | `impactMetal_heavy_{000,001,002}.ogg` |
| `wood-break-{1,2,3}.ogg` | Kenney / Impact Sounds | `impactWood_heavy_{000,001,002}.ogg` |
| `glass-break-{1,2,3}.ogg` | Kenney / Impact Sounds | `impactGlass_heavy_{000,001,002}.ogg` |
| `step-grass-{1,2,3}.ogg` | Kenney / Impact Sounds | `footstep_grass_{000,001,002}.ogg` |
| `step-floor-{1,2,3}.ogg` | Kenney / Impact Sounds | `footstep_concrete_{000,001,002}.ogg` |
| `metal-hit-{1,2,3}.ogg` | [Kenney / Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | `impactMetal_{000,001,002}.ogg` |
| `door-close.ogg` | Kenney / Sci-fi Sounds | `doorClose_001.ogg` |
| `mech-motor.ogg` | Kenney / Sci-fi Sounds | `engineCircular_001.ogg` |
| `ship-hum.ogg`, `thruster.ogg` | Kenney / Sci-fi Sounds | `spaceEngineLow_000.ogg`, `spaceEngine_000.ogg` |
| `shield-hit.ogg`, `metal-break.ogg`, `mech-shot.ogg` | Kenney / Sci-fi Sounds | `forceField_001.ogg`, `explosionCrunch_001.ogg`, `laserLarge_000.ogg` |
| `ship-shot-{1,2}.ogg` | Kenney / Sci-fi Sounds | `laserSmall_{000,001}.ogg` |
| `interceptor-shot-{1,2}.ogg` | Kenney / Sci-fi Sounds | `laserSmall_003.ogg`, `laserRetro_002.ogg` |
| `capital-shot.ogg` | Kenney / Sci-fi Sounds | `laserLarge_004.ogg` |
| `sword-clash-{1,2,3}.ogg` | [StarNinjas / 20 Sword Sound Effects](https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes) | `sword_clash.{1,2,3}.ogg` from `sword_clash_-_starninjas_0.zip` |
| `birds.ogg` | [isaiah658 / Ambient Bird Sounds](https://opengameart.org/content/ambient-bird-sounds) | `birds-isaiah658_0.ogg` |
| `wind.ogg` | [IgnasD / Wind](https://opengameart.org/content/wind) | `wind/Wind2.ogg` from `wind.zip` |
| `leaves.ogg` | [qubodup / 20 Rustles of dry leaves](https://opengameart.org/content/20-rustles-dry-leaves) | `rustle/rustle01.flac` from `qubodup-rustle.7z` |
| `fire.ogg` | [AntumDeluge / Fire Crackling](https://opengameart.org/content/fire-crackling) | `fire-1.wav` |

License labels were verified on the original download pages and Kenney's
included license notices. Preparation: mono 44.1 kHz Vorbis quality 5, 35 Hz
high-pass, limiter ceiling 0.89 without automatic gain. Loop seams are blended
at runtime; source recordings are not repeatedly faded to silence.

## Mapping and mix

- Robot steps use three alternating metal-foot variants, triggered by distance
  travelled, not an idle timer. Player floor/grass footsteps retain foot-contact timing.
- Final mechs use heavy footsteps on the ground, pitched motors while actuating,
  and thrusters instead of ground footsteps in orbit.
- Sword swings, sword clashes, armour hits and shield contact are separate events.
- Original effects, including the sword-slash recording and tennis wall clang,
  retain their original files and playback. Added mech armour hits use a separate
  `metalHit` name, rather than replacing `clank`. Puzzle servo sounds are unchanged.
- Level 2 player guns add alternating cockpit laser recordings; interceptors
  use lighter positional lasers and capital-ship/scrambler cannons use a heavier
  recording. Enemy volleys play once per firing source, not once per pellet.
  Original flight tones and comic-effect sounds are retained underneath.
- Doors sound once at each movement start or reversal, with a different closing
  recording. Shared portal occupancy/locking logic is unchanged.
- Destructibles default to metal; wooden cargo uses wood impacts. Authored
  breakables can explicitly select metal, wood or glass with `soundMaterial`.
- Forest wind, leaves and birds come from live tree positions. Destroyed trees
  are excluded. Machinery belongs to indoor scenes, vents and visible shuttles;
  shuttle pitch and volume follow engine thrust.
- Crackling follows Brendan only during the burning clearing sequence, ending
  when the cinematic leaves it. No forest ambience follows the fight into space.
- Point sources have quadratic distance falloff, camera-relative stereo, and
  distance-dependent low-pass filtering. The Sound slider controls all sampled
  effects and ambience independently of Music. Menus, hidden tabs, loading and
  outgoing scenes stop voices; audible loops restart on resume.
- Ambient voices are limited to 10 and transient voices to 36. A shared
  compressor controls stacked combat peaks. Assets are included in game caching
  and decoded ahead of gameplay.
