const devlogTopics = [
  {
    id: "introduction",
    title: "Game introduction",
    category: "Meet Brondon",
    image: "stage1-overview.jpg",
    teaser:
      "A browser. A spaceship. A very personal revenge story. Here's the world we're building.",
    intro:
      "Brondon's Revenge is a 3D browser game built with Three.js, mixing traversal, stealth, puzzles and combat across a ship and a planet.",
    paragraphs: [
      "The ship's enclosed rooms and surveillance systems give way to open jungle routes and a facility. Each setting changes the pace without losing the same central character and movement systems.",
      "This devlog is a look at the decisions behind the game: what you see while playing, what the code is doing, and why we chose to build it that way.",
    ],
    noteTitle: "The idea",
    note: "Different activities, one connected experience. The goal is not just to add systems, but to make movement, animation, camera and sound support each other.",
    footage:
      "A short montage: ship interior, third-person traversal, jungle exploration and a combat encounter.",
    snippets: [
      {
        title: "01 / A perspective on the world",
        explanation:
          "Three.js supplies the perspective camera used to render the world. The 75-degree vertical field of view, viewport aspect ratio and near/far clipping planes define the initial view; gameplay camera logic then positions it.",
        file: "src/core/camera.ts",
        symbol: "createCamera",
        code: `const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);`,
      },
      {
        title: "02 / Shared rules, not separate games",
        explanation:
          "Movement and physics use a shared configuration. These values make the baseline movement feel consistent as the player travels between environments.",
        file: "src/helpers/physics/scenePhysics.ts",
        symbol: "PHYSICS",
        code: `gravity: -9.82,
playerRadius: 0.3,
moveSpeed: 4.2,
jumpSpeed: 5.5,`,
      },
    ],
  },
  {
    id: "gameplay",
    title: "Gameplay mechanics",
    category: "Play / explore / survive",
    image: "stage2-camera-wall.jpg",
    teaser:
      "Stealth, traversal, surveillance puzzles and combat. Different ways to get even.",
    intro:
      "The gameplay moves between sneaking, climbing, solving surveillance puzzles and fighting. Player state keeps those actions from getting in each other's way.",
    paragraphs: [
      "The surveillance hub connects several activities, while vents and ladders turn the ship into more than a collection of corridors. Traversal is part of how the player reads and explores the level.",
      "An action is not just a key press. The controller checks whether it is valid in the current state: a grounded jump is allowed, but a slide or forced crouch changes what Brondon can do.",
    ],
    noteTitle: "Why state matters",
    note: "A jump during a slide or inside a low vent would break both the movement and the pose. Explicit conditions keep input, collision and animation in agreement.",
    footage:
      "Crouch through a vent, climb a ladder, enter a surveillance puzzle, then jump, slide and fight.",
    snippets: [
      {
        title: "01 / A jump has conditions",
        explanation:
          "A queued jump only becomes vertical velocity when the player is grounded, not sliding and not crouching. Clearing the queue afterwards prevents one press from retriggering on landing.",
        file: "src/scripts/player/player.ts",
        symbol: "beforePhysicsStep",
        code: `if (jumpQueued && !sliding && isOnGround && !crouching && !crouchForced) {
  playerBody.velocity.y = PHYSICS.jumpSpeed;
  playJumpSound(0.5);
  isOnGround = false;
  intentionalJump = true;
}
jumpQueued = false;`,
      },
      {
        title: "02 / Sliding follows its own timeline",
        explanation:
          "A slide ends when the player leaves the ground or its duration expires. Otherwise, movement follows the stored slide direction and a time-dependent speed curve, rather than ordinary walking input.",
        file: "src/scripts/player/player.ts",
        symbol: "beforePhysicsStep / sliding branch",
        code: `if (!isOnGround || slideTime >= SLIDE_TACKLE.duration) cancelSlide();
else {
  desired.set(-Math.sin(slideYaw), 0, -Math.cos(slideYaw));
  moveStrength = 1;
  const exitSpeed = keys.KeyW && !keys.KeyS ? currentMoveSpeed : 0;
  currentMoveSpeed = slideTackleSpeed(
    slideTime,
    slideEntrySpeed,
    exitSpeed,
  );
  slideTime = Math.min(SLIDE_TACKLE.duration, slideTime + _dt);
  jumpQueued = false;
}`,
      },
    ],
  },
  {
    id: "animation",
    title: "Character animation",
    category: "Making Brondon move",
    image: "living-quarters.jpg",
    teaser:
      "From an idle pose to a slide tackle: making the character match the action.",
    intro:
      "The animation system reads the controller's player state, chooses a clip and blends into it. Physics moves Brondon; animation makes that movement readable.",
    paragraphs: [
      "Walking, sprinting, crouching and climbing share the same state as the controller. Locomotion transitions have room to blend, while punches and Bloomstick attacks use shorter transitions for a sharper response.",
      "The work includes integrating and preparing clips for Brondon's rig. Imported Quaternius combat animations are third-party assets, not animations we claim to have hand-keyframed.",
    ],
    noteTitle: "One action, one clock",
    note: "The slide pose is sampled from the actual gameplay timeline. Changing how far the slide has progressed also changes how far the animation has progressed.",
    footage:
      "Third-person idle, walk, sprint and crouch, followed by climbing, an attack and a full slide.",
    snippets: [
      {
        title: "01 / Blending instead of snapping",
        explanation:
          "The selected action is reset, given its playback speed and blended in unless this is an immediate transition or the same action. Earlier in fadeTo, the previous action is faded out using the same blend duration.",
        file: "src/scripts/player/characterManager.ts",
        symbol: "fadeTo",
        code: `next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
if (!immediate && !sameAction) next.fadeIn(blend);
next.play();
currentAction = next;`,
      },
      {
        title: "02 / The slide pose follows gameplay",
        explanation:
          "Rather than letting the slide clip play freely, the system pauses it and sets its time explicitly. Normalised gameplay progress is clamped between zero and one, then mapped to the clip's duration.",
        file: "src/scripts/player/characterManager.ts",
        symbol: "playerState.sliding branch",
        code: `fadeTo("Slide_Tackle");
currentAction.paused = true;
currentAction.time =
  THREE.MathUtils.clamp(
    playerState.slideTime / SLIDE_TACKLE.duration,
    0,
    1,
  ) * currentAction.getClip().duration;`,
      },
    ],
  },
  {
    id: "cutscenes",
    title: "In-engine cutscenes",
    category: "Directing the moment",
    image: "facility.jpg",
    teaser:
      "Curved paths, deliberate framing and a photograph that changes the scene.",
    intro:
      "The facility arrival is staged inside the game engine. Brondon, the camera and the environment stay in the same world, rather than cutting to a separate movie.",
    paragraphs: [
      "Brondon follows a curved path, using its tangent to find his facing direction. The sequence then turns his attention toward the photograph.",
      "The camera moves from an establishing shot into a follow shot and finally a reveal. Easing and a narrowing field of view guide attention before control returns to the player.",
    ],
    noteTitle: "Show, then hand back",
    note: "The cutscene should direct attention without feeling like another game. Keeping it in-engine lets the reveal flow back into the playable environment.",
    footage:
      "Facility arrival: the establishing shot, Brondon's walk, the photograph reveal and the return to player control.",
    snippets: [
      {
        title: "01 / A path gives position and direction",
        explanation:
          "Both samples use the same path progress: one supplies the current position, the other supplies the direction along the curve. This keeps the walk and its facing connected.",
        file: "src/scenes/level 3/scene20.ts",
        symbol: "facility arrival / introPath",
        code: `introPath.getPointAt(progress, introPosition);
introPath.getTangentAt(progress, introTangent);`,
      },
      {
        title: "02 / Establish, follow, reveal",
        explanation:
          "The camera blends between opening, following and reveal positions. Its look target also moves toward the picture, so both the viewpoint and the subject of the shot change together.",
        file: "src/scenes/level 3/scene20.ts",
        symbol: "applyIntroCamera",
        code: `camera.position
  .lerpVectors(introOpeningCamera, introFollowCamera, follow)
  .lerp(introRevealCamera, reveal);
introLook.copy(introPosition).setY(1.3).lerp(picturePoint, reveal);`,
      },
    ],
  },
  {
    id: "environment",
    title: "World & environment",
    category: "Building the backdrop",
    image: "level3-jungle.jpg",
    teaser:
      "From tight ship interiors to a living jungle. Atmosphere is a system, too.",
    intro:
      "The ship uses equipment, corridors and surveillance stations as landmarks. The jungle contrasts those enclosed spaces with paths, clearings, water and moving foliage.",
    paragraphs: [
      "Repeated foliage is built with instanced geometry, grouped into spatial cells. Distance and frustum checks keep invisible batches from being drawn; they do not remove gameplay collision.",
      "Shader-driven wind adds movement without animating every leaf on the CPU. A shared time value drives the motion, while per-instance position offsets stop all the foliage from moving identically.",
    ],
    noteTitle: "Density with a budget",
    note: "Instancing reuses geometry, but it does not make the entire forest a single draw call. Spatial grouping and visibility checks still matter.",
    footage:
      "The surveillance hub's landmarks, then jungle paths and foliage moving while the live gameplay camera is active.",
    snippets: [
      {
        title: "01 / Feed wind time into the shader",
        explanation:
          "The material's shader receives the shared wind uniform before compilation. Changing the uniform value can move foliage without rebuilding the material or updating every vertex on the CPU.",
        file: "src/scripts/level-3/jungleFoliage.ts",
        symbol: "createJungleFoliageMaterials / onBeforeCompile",
        code: `shader.uniforms.uCanopyWind = wind;
shader.vertexShader =
  "uniform float uCanopyWind;\\n" + shader.vertexShader;`,
      },
      {
        title: "02 / Don't let every tree sway in sync",
        explanation:
          "This GLSL excerpt offsets the wind phase using each instance's world placement within the instance matrix. Different positions produce different phases while still sharing one wind clock.",
        file: "src/scripts/level-3/jungleFoliage.ts",
        symbol: "vertex shader injection",
        language: "GLSL",
        code: `float foliagePhase = uCanopyWind;
#ifdef USE_INSTANCING
  foliagePhase += instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.11;
#endif`,
      },
    ],
  },
  {
    id: "physics",
    title: "Physics & movement",
    category: "Under the hood",
    image: "secret-waterfall.jpg",
    teaser:
      "Grounded jumps, slopes and a fixed-step simulation. Getting the feel right.",
    intro:
      "cannon-es advances the physics world at a fixed 1/120-second step. Rendering has its own frame rate; movement is not simply tied to how often the screen redraws.",
    paragraphs: [
      "The loop accumulates frame time and performs fixed physics steps. Frame time and substep limits bound catch-up work after a slow frame.",
      "On the ground, movement follows the supporting surface. In the air, horizontal steering leaves vertical velocity intact so gravity and jumping can continue to do their work.",
    ],
    noteTitle: "120 Hz is not 120 FPS",
    note: "A fixed simulation step helps make movement predictable. It does not promise a 120 FPS render rate or identical results under every frame-time pattern.",
    footage:
      "Walk up a slope, stop, jump, land and walk against a solid obstacle.",
    snippets: [
      {
        title: "01 / Small, bounded physics steps",
        explanation:
          "Each iteration runs player preparation, advances the physics world, then reads the result. The loop consumes accumulated time until it runs out of full steps or reaches the substep cap. PHYSICS.fixedStep is 1 / 120 and maxSubSteps is 12.",
        file: "src/helpers/physics/scenePhysics.ts",
        symbol: "createScenePhysics / step",
        code: `while (
  accumulator + 1e-10 >= PHYSICS.fixedStep &&
  steps < PHYSICS.maxSubSteps
) {
  player.beforePhysicsStep(PHYSICS.fixedStep);
  stepPhysicsWorld(world, PHYSICS.fixedStep);
  player.afterPhysicsStep();
  accumulator = Math.max(0, accumulator - PHYSICS.fixedStep);
  steps++;
}`,
      },
      {
        title: "02 / Follow the floor, preserve the jump",
        explanation:
          "Grounded movement is projected onto the support plane and normalised. The airborne branch only writes x and z, preserving the existing vertical velocity instead of resetting a jump every frame.",
        file: "src/scripts/player/player.ts",
        symbol: "beforePhysicsStep / grounded movement",
        code: `if (isOnGround) {
  desired.y =
    -(desired.x * groundNormal.x + desired.z * groundNormal.z) /
    groundNormal.y;
  desired.normalize();
  desired.scale(currentMoveSpeed * moveStrength, playerBody.velocity);
} else {
  playerBody.velocity.x = desired.x * currentMoveSpeed;
  playerBody.velocity.z = desired.z * currentMoveSpeed;
}`,
      },
    ],
  },
  {
    id: "weapons",
    title: "The weapons wheel",
    category: "Choose your approach",
    image: "bloomstick.png",
    teaser:
      "Hold. Aim. Release. A radial menu that keeps weapon switching in the action.",
    intro:
      "Hold Tab to open the wheel, aim toward an available weapon and release to equip. The centre keeps your current weapon, Escape cancels, and Unarmed lets you holster.",
    paragraphs: [
      "Selection comes from the virtual cursor's angle around the centre, with a dead zone to avoid accidental changes.",
      "Opening the wheel pauses gameplay but retains pointer lock. Relative mouse movement chooses equipment without turning the gameplay camera.",
    ],
    noteTitle: "Make cancellation easy",
    note: "Not every menu opening should force a change. The centre dead zone and Escape give players explicit ways to keep what they already have equipped.",
    footage:
      "Open the wheel, select and equip a weapon, cancel with Escape, then select Unarmed. Show an enemy frozen while the wheel is open.",
    snippets: [
      {
        title: "01 / From cursor angle to weapon slot",
        explanation:
          "Invalid coordinates, an empty menu or a cursor inside the central dead zone return no selection. Otherwise atan2 gives an angle, rotated so the first slot starts at the top and rounded to the nearest segment.",
        file: "src/scripts/weapons/weaponWheel.ts",
        symbol: "weaponWheelIndex",
        code: `if (
  !Number.isFinite(x) ||
  !Number.isFinite(y) ||
  count < 1 ||
  Math.hypot(x, y) < DEAD_ZONE
)
  return -1;
const angle = (Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU;
return Math.round(angle / (TAU / count)) % count;`,
      },
      {
        title: "02 / Pause the world, keep the pointer",
        explanation:
          "The wheel records whether pointer lock is active and pauses the game. Keeping the pointer captured lets its input handlers use relative movement for menu selection rather than releasing the cursor.",
        file: "src/scripts/weapons/weaponWheel.ts",
        symbol: "openWheel",
        code: `root.classList.toggle("locked-pointer", !!document.pointerLockElement);
options.setPaused(true);`,
      },
    ],
  },
  {
    id: "camera",
    title: "Camera work",
    category: "Finding the right angle",
    image: "stage2-cargo.jpg",
    teaser:
      "Over the shoulder or through Brondon's eyes. A camera that knows when to get out of the way.",
    intro:
      "Brondon has an over-the-shoulder third-person follow camera, reminiscent of GTA or Assassin's Creed, and a first-person view. Press V to switch; tight spaces can also trigger first-person automatically.",
    paragraphs: [
      "Third-person shows Brondon's animation and gives spatial context. First-person makes aiming and close interactions direct. The follow view uses a shoulder offset, but its distance is not rigidly fixed.",
      "A 3-by-3 set of physics rays checks clearance around the camera's near-plane footprint. Near a wall, the camera pulls inward immediately; when there is too little space, it falls back to first-person instead of being pushed through the scenery.",
    ],
    noteTitle: "Playtest takeaway",
    note: "Players found the camera choice valid in the feedback described for this devlog. The important demonstration is the wall response: keep the view usable, then return smoothly when space opens up.",
    footage:
      "Show the same action in both views using V, back toward a wall in third-person until first-person takes over, then move out into clear space.",
    snippets: [
      {
        title: "01 / Move in now, ease back out",
        explanation:
          "The safe distance comes from obstruction checks. A smaller distance applies immediately to prioritise clearance. Moving outward uses exponential smoothing, avoiding an abrupt pullback when the wall is no longer in the way.",
        file: "src/core/camera.ts",
        symbol: "applyThirdPersonCamera / distance",
        code: `const distance =
  reset || safeDistance <= previous!.distance
    ? safeDistance
    : THREE.MathUtils.lerp(
        previous!.distance,
        safeDistance,
        1 - Math.exp(-6 * Math.min(dt, 0.1)),
      );`,
      },
      {
        title: "02 / First-person before clipping",
        explanation:
          "The enter and exit thresholds differ: a new obstruction triggers first-person below 0.75 units, while an already-forced first-person view needs more clearance to leave. That hysteresis reduces rapid toggling near a wall. Returning false tells the caller not to use third-person framing.",
        file: "src/core/camera.ts",
        symbol: "applyThirdPersonCamera / firstPerson",
        code: `const firstPerson =
  safeDistance < (wasFirstPerson ? 1.05 : 0.75) ||
  (wasFirstPerson && distance < 0.85);
followCameras.set(camera, { player, pivot, distance, firstPerson });
if (firstPerson) {
  camera.position.copy(firstPersonPosition);
  return false;
}`,
      },
    ],
  },
  {
    id: "music",
    title: "Original music",
    category: "The sound of revenge",
    image: "level2-space.jpg",
    teaser:
      "A score for each setting, transitions you can feel, and room to just listen.",
    intro:
      "Original music gives the game's spaces and encounters their own identity. The audio system connects that score to the scene and the current gameplay state.",
    paragraphs: [
      "Scene-to-track mapping supplies a baseline, while a scene can override its music as the action changes. Many transitions crossfade; some, such as a stealth alert, intentionally switch immediately.",
      "The original in-game tracks below let you hear the contrast. The gameplay recording can show how that music feels in context. Composition tools, instruments and influences should come from the composer's own account, not guesses made from the code.",
    ],
    noteTitle: "Leave room to listen",
    note: "Compare two contrasting moments without narration. Then explain the actual musical choices behind them. Opening the weapons wheel is also a useful demonstration: it muffles the background score.",
    footage:
      "A composition-session recording if available, then two contrasting gameplay passages with music audible, followed by a scene transition and a weapon-wheel open/close.",
    snippets: [
      {
        title: "01 / Let the scene choose the score",
        explanation:
          "A scene's getMusicTrack override takes priority. If it has none, the manager uses the scene-to-track map; with no match, it stops the background track rather than inventing a default.",
        file: "src/helpers/audio/gameMusic.ts",
        symbol: "syncScene",
        code: `setTrack(
  sceneData?.getMusicTrack?.() ??
    (sceneId ? sceneTracks.get(sceneId) : null) ??
    null,
);`,
      },
      {
        title: "02 / Crossfade when the transition calls for it",
        explanation:
          "When a background track is active and an immediate switch is not requested, the manager crossfades. Ordinary transitions use 0.9 seconds; scene21 uses the 3-second finale duration. Paused or immediate transitions use setBgm instead.",
        file: "src/helpers/audio/gameMusic.ts",
        symbol: "setTrack",
        code: `if (background.bgm && !paused && !immediate) {
  background.crossfadeBgm(
    settings,
    sceneId === "scene21"
      ? FINAL_BOSS_CROSSFADE_SECONDS
      : MUSIC_CROSSFADE_SECONDS,
  );
} else background.setBgm(settings);`,
      },
      {
        title: "03 / The menu changes what you hear",
        explanation:
          "The weapon-wheel state is forwarded to the background audio manager, which muffles the score while the selection interface is open.",
        file: "src/helpers/audio/gameMusic.ts",
        symbol: "setWeaponWheelOpen",
        code: `setWeaponWheelOpen(open: boolean) {
  background.setBgmMuffled(open);
},`,
      },
    ],
  },
];
