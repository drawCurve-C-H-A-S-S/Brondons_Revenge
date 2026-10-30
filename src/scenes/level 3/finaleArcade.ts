import * as THREE from "three";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { playSfx } from "../../helpers/audio/sfx.js";
import { createPlayer } from "../../scripts/player/player.js";
import {
  readLocalControllers, controllerButtonLabel,
  type LocalControllerInput,
} from "../../scripts/player/gamepadInput.js";
import { createLocalMechDuel, DUEL, LOCAL_DUEL, LOCAL_SPECIAL_NAMES, type MechSide } from "../../scripts/npc/mechDuel.js";
import {
  isMeleeStrike, sampleMeleeBlade, sampleFinisher, FINISHER_BEATS,
  FINISHER_EXECUTION, MELEE_STRIKES, cinematicProgress,
  HERO_ULTIMATE, ENEMY_ORBITAL_CUT, ENEMY_VERDICT,
} from "../../scripts/global/finaleChoreography.js";
import type { MechPoseName } from "../../scripts/npc/mechAnimation.js";
import { FACILITY_ROOF_SEQUENCE } from "../../scripts/global/facilityArchitecture.js";
import { createFinaleMech } from "../../scripts/level-3/finaleMechs.js";
import { createBladeTrail, createFinaleEffects, finaleExecutionSlash } from "../../scripts/level-3/finaleEffects.js";
import { createFinaleRenderer } from "../../scripts/level-3/finaleRenderer.js";
import { createFinaleProjectiles } from "../../scripts/level-3/finaleProjectiles.js";
import { createPlanetBreakerCore } from "../../scripts/level-3/facilityCore.js";
import { createFinaleSite } from "../../scripts/level-3/finaleSite.js";
import { createFinaleWorld, FINALE_BATTLE_YAW, SPACE_ALTITUDE, finaleBattlePoint } from "../../scripts/level-3/finaleWorld.js";
import { FRAME_COLORS } from "../../scripts/level-3/finaleMaterials.js";
import { createShipInteriorMaterials, createShipServiceDetails } from "../../scripts/global/shipInterior.js";
import { prepareShipSurfaceMesh } from "../../scripts/global/shipSurface.js";
import { disposeRoom } from "../../scripts/global/shipRoom.js";
import { emitComicEffect, disposeComicEffects } from "../../scripts/global/comicEffects.js";

type ControllerSeat = { index: number; id: string };
export interface FinaleLocalMatch {
  arena: "facility" | "bay13";
  characters: [MechSide, MechSide];
  controllers: [ControllerSeat, ControllerSeat];
}
interface Options {
  renderer: THREE.WebGLRenderer;
  match?: FinaleLocalMatch;
  onStory: () => void;
  onMatch: (match: FinaleLocalMatch) => void;
  onSetup: () => void;
  onExit: () => void;
  onPause: () => void;
}
const NAMES = { hero: "OPUS", enemy: "FINAL VERDICT" };
const SIDES = [0, 1] as const;
const TINTS = [0x6adcf5, 0xff976d];
const REVENGE_BEAT = FINISHER_BEATS.find((beat) => beat.shot === "finalCut")!;

/** Cutaway Bay 13: the parked service lift, steel shell and four corner pillars. */
function createBayArena(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "Bay13LocalArena";
  scene.add(root);
  const { steel, dark, trim, deck, cyan } = createShipInteriorMaterials(8, 8);
  const amber = new THREE.MeshBasicMaterial({ color: 0xeab76a });
  function box(size: [number, number, number], at: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.receiveShadow = true;
    mesh.userData.shipSurfaceContinuous = true;
    root.add(mesh);
    prepareShipSurfaceMesh(mesh);
    return mesh;
  }
  box([40, 0.5, 48], [0, -0.25, 0], deck);
  box([0.6, 14, 48], [-20.3, 7, 0], steel);
  box([0.6, 14, 48], [20.3, 7, 0], steel);
  box([40, 14, 0.6], [0, 7, -24.3], steel);
  // The camera-facing wall and roof are cut away, keeping the whole arena visible.
  for (const x of [-13, 13]) for (const z of [-15, 15]) {
    box([1.2, 13.5, 1.2], [x, 6.75, z], dark);
    for (const y of [0.4, 12.8]) box([1.6, 0.22, 1.6], [x, y, z], amber);
  }
  for (const x of [-19.6, 19.6]) {
    box([0.08, 0.06, 44], [x, 0.04, 0], cyan);
    box([0.14, 0.2, 42], [x, 12, 0], amber);
  }
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.12, 48), trim);
  lift.name = "ParkedBay13ServiceLift";
  lift.position.y = 0.06;
  root.add(lift);
  root.add(createShipServiceDetails({ width: 40, depth: 48, height: 14, spacing: 6, ribs: false,
    label: "BAY 13 / HEAVY SERVICE", accent: 0xd3af71 }));
  scene.background = new THREE.Color(0x101a28);
  scene.add(new THREE.HemisphereLight(0xc9e5ff, 0x182231, 2.5));
  const key = new THREE.DirectionalLight(0xffe5bf, 3);
  key.position.set(-12, 28, 18);
  scene.add(key);
  return root;
}

export function createScene({ renderer, match, onStory, onMatch, onSetup, onExit, onPause }: Options) {
  const site = match?.arena === "facility" ? createFinaleSite() : null;
  const scene = site?.scene ?? new THREE.Scene();
  const bay = site ? null : createBayArena(scene);
  if (site) {
    site.updateRoofSequence(FACILITY_ROOF_SEQUENCE.liftEnd);
    site.boy.visible = site.ship.root.visible = false;
    scene.userData.forestQuiet = true;
    scene.fog = new THREE.Fog(0x344354, 160, 440);
  }
  const scale = site ? 1 : 0.45;
  const arenaBackground = scene.background instanceof THREE.Color ? scene.background.clone() : scene.background;
  const arenaFog = scene.fog?.clone() ?? null;
  let altitude = 0;
  const point = (x: number, y = 0) => site ? finaleBattlePoint(x, y, altitude) : new THREE.Vector3(x * scale, (y + altitude) * scale + 0.12, 0);
  const ground = new THREE.Group();
  ground.name = "LocalGroundArena";
  ground.add(...scene.children);
  scene.add(ground);
  const orbitalWorld = match ? createFinaleWorld(scene, { renderer }) : null;
  if (orbitalWorld) {
    orbitalWorld.root.scale.setScalar(scale);
    orbitalWorld.root.position.copy(point(0)).addScaledVector(finaleBattlePoint(0), -scale);
    orbitalWorld.root.visible = false;
  }
  scene.background = arenaBackground;
  scene.fog = arenaFog;
  const bomb = match ? createPlanetBreakerCore() : null;
  if (bomb) {
    bomb.root.visible = false;
    bomb.root.scale.setScalar(scale);
    scene.add(bomb.root);
  }
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 10000);
  const physics = createScenePhysics();
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: point(0, 1) });
  player.disable();
  player.clearInput();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = window.innerWidth < 700;
  const effects = match ? createFinaleEffects(scene, reducedMotion, mobile) : null;
  const mechs = match ? match.characters.map((side) => createFinaleMech(side)) : [];
  const trails = match ? SIDES.map((i) => createBladeTrail(scene, match.characters[i])) : [];
  const duel = match ? createLocalMechDuel(match.characters) : null;
  const markerGeometry = new THREE.RingGeometry(3.7, 4.05, 48);
  const markers = match ? SIDES.map((i) => {
    const mesh = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: TINTS[i], side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    return mesh;
  }) : [];
  mechs.forEach((mech, i) => {
    mech.root.name = `LocalPlayer${i + 1}-${NAMES[match!.characters[i]]}`;
    mech.root.position.copy(point(i === 0 ? -14 : 14));
    mech.root.scale.setScalar(scale);
    scene.add(mech.root);
  });
  const projectiles = match ? createFinaleProjectiles(scene) : null;
  const orbitalLights = new THREE.Group();
  orbitalLights.visible = false;
  orbitalLights.add(new THREE.HemisphereLight(0xc9dcff, 0x182231, 2));
  const orbitalLight = new THREE.DirectionalLight(0xffe6d3, 3);
  orbitalLight.position.set(-20, 120, 35);
  orbitalLights.add(orbitalLight);
  scene.add(orbitalLights);
  const hud = document.createElement("section");
  hud.className = "finale-local";
  hud.setAttribute("aria-label", "Final boss arcade");
  hud.innerHTML = `<section class="finale-local-menu">
    <p class="finale-local-kicker">ARCADE / THE FINAL FIGHT</p><h1>CHOOSE YOUR FIGHT</h1>
    <div class="finale-local-modes">
      <button type="button" data-mode="story"><strong>STORY REPLAY</strong><span>The complete final battle, cinematics, and ending screen.</span></button>
      <button type="button" data-mode="versus"><strong>LOCAL 1V1</strong><span>Two players. One computer. Two controllers.</span></button>
    </div>
    <div class="finale-local-lobby" hidden>
      <p>Press Start on each controller to join. Left / right selects your mech. Start readies your player.</p>
      <div class="finale-local-seats">
        <article><h2>PLAYER ONE</h2><p data-seat="0"></p><button type="button" data-character="0">OPUS</button><small data-ready="0"></small></article>
        <article><h2>PLAYER TWO</h2><p data-seat="1"></p><button type="button" data-character="1">FINAL VERDICT</button><small data-ready="1"></small></article>
      </div>
      <button type="button" data-arena>ARENA: FACILITY</button>
      <p>Player One: up / down changes arena. Mirror matches are allowed.</p>
      <button type="button" data-lobby-back>BACK TO MODES</button>
    </div>
    <button type="button" data-exit>RETURN TO MUSEUM</button>
  </section>
  <div class="finale-local-status" hidden>
    ${SIDES.map((i) => `<section class="finale-player-status" data-player="${i}" aria-label="Player ${i + 1}">
      <div class="finale-status-heading"><strong data-name="${i}"></strong><span class="finale-health-value" data-stats="${i}"></span></div>
      <meter class="finale-integrity" data-health-meter="${i}" min="0" max="1000" value="1000"></meter>
    </section>`).join("")}
  </div>
  <div class="finale-local-edges" hidden>
    ${SIDES.map((i) => `<section class="finale-local-moves" data-player="${i}" aria-label="Player ${i + 1} moves and controls">
      <div class="finale-local-systems">
        <span class="finale-control finale-control-charge" data-control="rifle" data-primary="${i}"><kbd data-primary-key="${i}">X</kbd><small><b data-primary-name="${i}"></b><em data-primary-status="${i}"></em></small></span>
        <span class="finale-control finale-control-charge" data-control="special" data-secondary="${i}"><kbd data-secondary-key="${i}">A</kbd><small><b data-secondary-name="${i}"></b><em data-secondary-status="${i}"></em></small></span>
        <span class="finale-control finale-control-charge" data-control="guard" data-shield="${i}" aria-label="Shield"><kbd data-shield-key="${i}">ZL</kbd><small><b>SHIELD</b><em data-shield-status="${i}"></em></small></span>
        <span class="finale-control finale-control-charge finale-local-ultimate" data-ultimate="${i}"><kbd data-ultimate-key="${i}">ZR+B</kbd><small><b data-ultimate-name="${i}"></b><em data-charge="${i}"></em></small></span>
      </div>
      <small data-controls="${i}"></small>
    </section>`).join("")}
  </div>
  <div class="finale-local-banner" role="status"></div>
  <div class="finale-flash finale-local-flash" aria-hidden="true"></div>
  <section class="finale-local-result" hidden><p>LOCAL 1V1</p><h1></h1>
    <button type="button" data-rematch>REMATCH</button><button type="button" data-setup>CHANGE FIGHTERS / ARENA</button><button type="button" data-return>RETURN TO MUSEUM</button>
  </section>`;
  document.body.append(hud);
  document.body.classList.add("finale-active", "finale-local-active");
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => hud.querySelector<T>(selector)!;
  const menu = get(".finale-local-menu"), lobby = get(".finale-local-lobby"), modes = get(".finale-local-modes");
  const banner = get(".finale-local-banner"), result = get(".finale-local-result");
  const seats: Array<ControllerSeat | null> = match ? match.controllers.map((seat) => ({ ...seat })) : [null, null];
  const characters: [MechSide, MechSide] = match ? [...match.characters] : ["hero", "enemy"];
  let arena: FinaleLocalMatch["arena"] = match?.arena ?? "facility";
  const readySeats = [false, false];
  const previous = new Map<string, ReadonlySet<string>>();
  const keyOf = (pad: ControllerSeat) => `${pad.index}:${pad.id}`;
  const same = (a: ControllerSeat | null, b: ControllerSeat) => a?.index === b.index && a.id === b.id;
  let disposed = false, paused = false, leaving = false, loaded = !match, needsNeutral = true;
  let countdown = 3, outcomeShown = false, lastPhase = "fight", clock = 0;
  let pausePlayer = 0;
  let lastBombTime = -1;
  let lastArenaStage = "ground", transitionFade = 0;
  const specialClocks = [0, 0], phantomCuts = [-1, -1];
  let post: ReturnType<typeof createFinaleRenderer> | null = null;
  const events = new AbortController();
  function leave(action: () => void) { if (leaving || disposed) return; leaving = true; duel?.clearInput(); action(); }
  function chooseCharacter(i: 0 | 1) { characters[i] = characters[i] === "hero" ? "enemy" : "hero"; readySeats[i] = false; refreshLobby(); }
  function chooseArena() { arena = arena === "facility" ? "bay13" : "facility"; readySeats.fill(false); refreshLobby(); }
  function refreshLobby() {
    for (const i of SIDES) {
      get(`[data-seat="${i}"]`).textContent = seats[i] ? `Controller ${seats[i]!.index + 1} joined` : "Waiting for controller / press Start";
      get(`[data-character="${i}"]`).textContent = NAMES[characters[i]];
      get(`[data-ready="${i}"]`).textContent = readySeats[i] ? "READY" : "Press Start when ready";
    }
    get("[data-arena]").textContent = `ARENA: ${arena === "facility" ? "FACILITY" : "BAY 13"}`;
  }
  function modeSelect() { lobby.hidden = true; modes.hidden = false; get<HTMLButtonElement>('[data-mode="story"]').focus(); }
  function versusSelect() { modes.hidden = true; lobby.hidden = false; readySeats.fill(false); refreshLobby(); }
  get('[data-mode="story"]').onclick = () => leave(onStory);
  get('[data-mode="versus"]').onclick = versusSelect;
  get("[data-lobby-back]").onclick = modeSelect;
  for (const i of SIDES) get(`[data-character="${i}"]`).onclick = () => chooseCharacter(i);
  get("[data-arena]").onclick = chooseArena;
  get("[data-exit]").onclick = get("[data-return]").onclick = () => leave(onExit);
  get("[data-setup]").onclick = () => leave(onSetup);
  get("[data-rematch]").onclick = () => {
    if (match && seats[0] && seats[1]) leave(() => onMatch({ arena, characters, controllers: [seats[0]!, seats[1]!] }));
  };
  if (match) {
    menu.hidden = true;
    get(".finale-local-status").hidden = false;
    get(".finale-local-edges").hidden = false;
    for (const i of SIDES) {
      get(`[data-name="${i}"]`).textContent = `P${i + 1} / ${NAMES[characters[i]]}`;
      const names = LOCAL_SPECIAL_NAMES[characters[i]];
      const shortNames = characters[i] === "hero" ? ["TEARS", "WILL", "REVENGE"] : ["REBEL", "ECLIPSE", "VERDICT"];
      for (const [j, slot] of ["primary", "secondary", "ultimate"].entries()) {
        get(`[data-${slot}-name="${i}"]`).textContent = shortNames[j];
        get(`[data-${slot}="${i}"]`).title = names[j];
        get(`[data-${slot}="${i}"]`).setAttribute("aria-label", names[j]);
      }
    }
  } else modeSelect();
  function navigate(pressed: (action: string) => boolean, root: HTMLElement) {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.getClientRects().length && !b.disabled);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = pressed("left") || pressed("up") ? -1 : pressed("right") || pressed("down") ? 1 : 0;
    if (step) buttons[(Math.max(0, index) + step + buttons.length) % buttons.length]?.focus();
    if (pressed("confirm")) (buttons[index] ?? buttons[0])?.click();
    if (pressed("back")) leave(onExit);
  }
  function suspend() { needsNeutral = true; countdown = 3; duel?.clearInput(); }
  window.addEventListener("blur", suspend, { signal: events.signal });
  document.addEventListener("visibilitychange", suspend, { signal: events.signal });

  function updatePhysics(delta: number) {
    if (disposed || leaving || paused || document.hidden || !document.hasFocus()) return;
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
    const pads = readLocalControllers();
    const fresh = new Map(pads.map((pad) => [keyOf(pad), new Set(
      [...pad.held].filter((button) => previous.has(keyOf(pad)) && !previous.get(keyOf(pad))!.has(button)),
    )]));
    for (const pad of pads) previous.set(keyOf(pad), new Set(pad.held));
    for (const key of previous.keys()) if (!pads.some((pad) => keyOf(pad) === key)) previous.delete(key);
    const pressed = (pad: LocalControllerInput, action: string) => !!fresh.get(keyOf(pad))?.has(action);
    if (!match) {
      if (lobby.hidden) {
        if (pads[0]) navigate((action) => pressed(pads[0], action), menu);
        return;
      }
      for (const i of SIDES) if (seats[i] && !pads.some((pad) => same(seats[i], pad))) { seats[i] = null; readySeats[i] = false; }
      for (const pad of pads) {
        const assigned = seats.findIndex((seat) => same(seat, pad));
        if (assigned < 0) {
          if (pressed(pad, "start")) { const empty = seats.indexOf(null); if (empty >= 0) seats[empty] = { index: pad.index, id: pad.id }; }
          continue;
        }
        const i = assigned as 0 | 1;
        if (pressed(pad, "left") || pressed(pad, "right")) chooseCharacter(i);
        if (i === 0 && (pressed(pad, "up") || pressed(pad, "down"))) chooseArena();
        if (pressed(pad, "start")) readySeats[i] = !readySeats[i];
        if (pressed(pad, "cancel")) readySeats[i] = false;
        if (pressed(pad, "back")) modeSelect();
      }
      refreshLobby();
      if (seats[0] && seats[1] && readySeats.every(Boolean))
        leave(() => onMatch({ arena, characters: [...characters], controllers: [seats[0]!, seats[1]!] }));
      return;
    }
    if (!loaded || !duel || !effects || !orbitalWorld) return;
    if (outcomeShown) {
      if (pads[0]) navigate((action) => pressed(pads[0], action), result);
      duel.update(dt);
      clock = duel.getState().time;
      post?.update(dt);
      poseFighters(dt);
      effects.update(dt);
      return;
    }
    // Slots survive disconnection; a replacement must explicitly claim a missing seat with Start.
    for (const pad of pads) if (pressed(pad, "start") && !seats.some((seat) => same(seat, pad))) {
      const missing = seats.findIndex((seat) => !pads.some((connected) => same(seat, connected)));
      if (missing >= 0) { seats[missing] = { index: pad.index, id: pad.id }; suspend(); }
    }
    const assigned = seats.map((seat) => pads.find((pad) => same(seat, pad)));
    if (assigned.some((pad) => !pad)) {
      suspend();
      banner.textContent = `PLAYER ${assigned[0] ? "TWO" : "ONE"} CONTROLLER DISCONNECTED / reconnect, or press Start on a replacement`;
      return;
    }
    if (needsNeutral) {
      banner.textContent = "RELEASE CONTROLS / GET READY";
      if (assigned.every((pad) => pad!.held.size === 0 && Math.hypot(pad!.stick.x, pad!.stick.y) < 0.05)) needsNeutral = false;
      poseFighters(dt);
      effects.update(dt);
      return;
    }
    const pausingPlayer = assigned.findIndex((pad) => pressed(pad!, "start"));
    if (pausingPlayer >= 0) { pausePlayer = pausingPlayer; suspend(); onPause(); return; }
    if (countdown > 0) {
      countdown = Math.max(0, countdown - dt);
      banner.textContent = countdown > 0 ? String(Math.ceil(countdown)) : "FIGHT!";
      poseFighters(dt);
      effects.update(dt);
      return;
    }
    for (const i of SIDES) {
      const pad = assigned[i]!;
      duel.setInput(i, { move: pad.stick.x, lift: -pad.stick.y, guard: pad.held.has("guard") });
      if (pressed(pad, "ultimate")) duel.act(i, "ultimate");
      else if (!pad.held.has("ultimate")) {
        for (const [button, action] of [["sword", "slash"], ["shoot", "missiles"], ["dodgeButton", "dash"], ["special", "overdrive"], ["slide", "slide"]] as const)
          if (pressed(pad, button)) duel.act(i, action);
      }
      const label = (button: Parameters<typeof controllerButtonLabel>[0]) => controllerButtonLabel(button, pad.type);
      get(`[data-primary-key="${i}"]`).textContent = label("x");
      get(`[data-secondary-key="${i}"]`).textContent = label("a");
      get(`[data-shield-key="${i}"]`).textContent = label("zl");
      get(`[data-ultimate-key="${i}"]`).textContent = `${label("zr")}+${label("b")}`;
      get(`[data-controls="${i}"]`).textContent = `LS ${duel.getState().stage === "space" ? "FLY" : "MOVE"} · ${label("r")} BLADE · ${label("b")} DODGE${duel.getState().stage === "space" ? "" : ` · ${label("y")} SLIDE`}`;
    }
    post?.update(dt);
    duel.update(dt);
    const state = duel.getState();
    clock = state.time;
    if (lastPhase === "bomb" && state.phase === "fight") suspend();
    lastPhase = state.phase;
    banner.textContent = "";
    poseFighters(dt);
    for (const event of duel.drainEvents()) {
      const position = point(event.x, event.y);
      const index = event.owner === "hero" ? 0 : 1;
      const side = characters[index], tint = FRAME_COLORS[side];
      const source = mechs[index], victim = mechs[1 - index];
      if (event.kind === "parry" || event.kind === "guard") {
        effects.deflect(position, event.kind === "parry", characters[1 - index]);
        if (event.kind === "parry") {
          effects.swordClash(position, 0xffd99a);
          emitComicEffect(scene, "clank", { position, size: 5.5 * scale });
        }
        playSfx(event.kind === "parry" ? "swordClash" : "shieldHit", 0.7);
        if (event.kind === "parry") post?.impact();
      } else if (event.kind === "hit" || event.kind === "guardBreak") {
        effects.sparks(position, tint, 10);
        if (event.trace) {
          const tracePoint = (p: [number, number, number]) => point(p[0], p[1]).add(
            site ? new THREE.Vector3(-0.2425356, 0, -0.9701425).multiplyScalar(p[2]) :
              new THREE.Vector3(0, 0, -p[2] * scale),
          );
          const from = tracePoint(event.trace.from), to = tracePoint(event.trace.to);
          victim.markSlash(from, to);
          effects.slash(from, to, tint);
        }
        if (event.kind === "guardBreak") effects.ring(position, 3.8 * scale, 0xc9827a, true, 0.35);
        playSfx("metalHit", 0.7);
        if (event.damage >= 90 || event.kind === "guardBreak") post?.impact();
      } else if (event.kind === "swing") playSfx("slash", 0.65);
      else if (event.kind === "launch") {
        const origin = event.attack === "missiles" ? source.getMuzzle() : source.getBlade().tip;
        effects.sparks(origin, tint, event.attack === "missiles" ? 6 : 12);
        if (event.attack === "missiles")
          effects.muzzle(origin, victim.getChest().sub(origin).normalize(), side);
        else if (event.attack === "overdrive" || event.attack === "orbitalCut") {
          const blade = source.getBlade();
          effects.slash(blade.base, blade.tip, tint);
          effects.ring(origin, 2.4 * scale, 0xe5faff, true, 0.3);
        }
        playSfx("mechShot", 0.6);
      } else if (event.kind === "special") {
        effects.ring(position, 2.8 * scale, tint, true, 0.5);
        if (event.attack === "orbitalCut") {
          effects.ring(source.getChest(), 7 * scale, tint, true, 1.25);
          effects.sparks(source.getBlade().tip, tint, 24);
        }
        playSfx("shieldHit", 0.6);
      } else if (event.kind === "dash") effects.ring(position, 2.6 * scale, tint, true, 0.3);
      else if (event.kind === "rupture") {
        effects.ring(point(state.bombX!, 9), 3 * scale, 0xff9d68, true, 1.2);
        playSfx("shieldHit", 0.7);
      }
    }
    effects.update(dt);
    site?.update(dt, false);
    if (state.winner !== null) {
      outcomeShown = true;
      result.hidden = false;
      get(".finale-local-result h1").textContent = `PLAYER ${state.winner === 0 ? "ONE" : "TWO"} WINS`;
      get<HTMLButtonElement>("[data-rematch]").focus();
      duel.clearInput();
    }
  }
  function poseFighters(dt: number) {
    if (!duel || !effects) return;
    const enteredSpace = updateArena(dt);
    const state = duel.getState();
    for (const i of SIDES) {
      const f = duel.fighters[i];
      mechs[i].root.position.copy(point(f.x, f.y));
      mechs[i].root.rotation.set(0, (site ? FINALE_BATTLE_YAW : Math.PI / 2) + (f.facing < 0 ? Math.PI : 0), 0);
    }
    for (const i of SIDES) {
      const f = duel.fighters[i], mech = mechs[i];
      const target = duel.fighters[1 - i];
      const revenge = f.ultimateActive && characters[i] === "hero"
        ? sampleFinisher(REVENGE_BEAT, f.time) : null;
      mech.root.rotation.z = revenge?.heroRoll ?? 0;
      mech.root.visible = revenge?.heroVisible ?? true;
      mech.setDissolve(revenge?.heroDissolve ?? 0);
      mech.setPowerUp(revenge ? 1 : 0);
      mech.setMotion(f.vx * f.facing, 0);
      mech.setGuarding(duel.guarding(i));
      mech.setDamage(1 - f.health / LOCAL_DUEL.health);
      let pose: MechPoseName = state.winner === i ? "victory" : f.move;
      let poseTime = f.time, poseDuration = f.duration || 1;
      if (revenge) {
        pose = revenge.heroPose;
        poseDuration = isMeleeStrike(pose) ? MELEE_STRIKES[pose].duration : 1;
        poseTime = revenge.heroPoseProgress * poseDuration;
      } else if (state.phase === "bomb") {
        pose = "guard";
        poseTime = state.bombTime;
        poseDuration = LOCAL_DUEL.bombSeconds;
      }
      mech.pose(pose, poseTime, poseDuration, state.stage === "space" || altitude > 1, f.combo, clock, !!revenge || state.phase === "bomb");
      if (f.move === "missiles") mech.aimGun(point(target.x, target.y + 9));
      if (f.move === "verdict") mech.pointSwordAt(point(f.aimLocked ? f.aimX : target.x, f.aimLocked ? f.aimY : target.y + 9));
      markers[i].position.copy(point(f.x, 0.2));
      markers[i].scale.setScalar(scale);
      markers[i].visible = state.stage === "ground" && state.phase !== "bomb";
      const blade = mech.getBlade();
      const release = f.move === "overdrive" ? HERO_ULTIMATE : f.move === "orbitalCut" ? ENEMY_ORBITAL_CUT : ENEMY_VERDICT;
      const charge = !revenge && (f.move === "overdrive" || f.move === "orbitalCut" || f.move === "verdict")
        ? cinematicProgress(f.time, 0.15, release.cameraEnd) *
          (1 - cinematicProgress(f.time, release.release, release.release + 0.2)) : 0;
      mech.setBladeCharge(charge);
      const slot = i === 0 ? "hero" : "enemy";
      effects.chargeBlade(blade.base, blade.tip, charge, clock, slot, FRAME_COLORS[characters[i]]);
      const trailActive = isMeleeStrike(f.move) ? sampleMeleeBlade(f.move, f.time).active :
        f.move === "overdrive" && f.time >= HERO_ULTIMATE.cameraEnd && f.time <= HERO_ULTIMATE.release + 0.1;
      trails[i].update(blade.base, blade.tip, dt,
        state.phase !== "bomb" && !revenge && !duel.guarding(i) && trailActive);
      effects.shield(mech.getShieldCenter(), DUEL.shieldRadius * scale, duel.guarding(i) ? 0.55 : 0, clock, false, slot, FRAME_COLORS[characters[i]]);
      if (revenge) {
        const crossed = (at: number) => specialClocks[i] < at && f.time >= at;
        if (crossed(FINISHER_EXECUTION.vanish)) {
          effects.teleport(mech.root.position, false);
          trails[i].clear();
        }
        if (crossed(FINISHER_EXECUTION.appear)) {
          effects.teleport(mech.root.position, true);
          post?.impact();
        }
        const count = Math.min(FINISHER_EXECUTION.slashes - 1, Math.floor(
          cinematicProgress(f.time, FINISHER_EXECUTION.cuts, FINISHER_EXECUTION.lastCut) * FINISHER_EXECUTION.slashes,
        ));
        if (f.time >= FINISHER_EXECUTION.cuts) for (let cut = phantomCuts[i] + 1; cut <= count; cut++) {
          const victim = mechs[1 - i];
          const { from, to } = finaleExecutionSlash(victim.root, cut);
          victim.markSlash(from, to);
          effects.slash(from, to, FRAME_COLORS.hero);
          effects.sparks(from.clone().lerp(to, 0.5), 0xd5edf1, 7);
          if (cut % 9 === 0) post?.impact();
        }
        if (crossed(FINISHER_EXECUTION.lastCut)) {
          const chest = mechs[1 - i].getChest();
          for (const sign of [-1, 1])
            effects.slash(chest.clone().add(new THREE.Vector3(-10, sign * 7, 2).multiplyScalar(scale)),
              chest.clone().add(new THREE.Vector3(10, -sign * 7, 2).multiplyScalar(scale)), 0xe8fcff);
          effects.ring(chest, 5 * scale, FRAME_COLORS.hero, true, 0.4);
          post?.impact();
        }
        if (f.time >= FINISHER_EXECUTION.cuts) phantomCuts[i] = count;
        specialClocks[i] = f.time;
      } else {
        specialClocks[i] = 0;
        phantomCuts[i] = -1;
      }
      const meter = get<HTMLMeterElement>(`[data-health-meter="${i}"]`);
      meter.value = f.health;
      meter.setAttribute("aria-label", `Player ${i + 1} health: ${Math.ceil(f.health)} / ${LOCAL_DUEL.health}`);
      get(`[data-player="${i}"]`).dataset.health = f.health <= 250 ? "low" : f.health <= 500 ? "mid" : "high";
      get(`[data-stats="${i}"]`).textContent = `${Math.ceil(f.health)} / ${LOCAL_DUEL.health}`;
      const setCharge = (control: string, status: string, ratio: number, ready: boolean, text: string) => {
        const element = get(`[data-${control}="${i}"]`);
        element.style.setProperty("--charge", `${Math.max(0, Math.min(1, ratio)) * 100}%`);
        element.classList.toggle("ready", ready);
        element.classList.toggle("charging", !ready);
        get(`[data-${status}="${i}"]`).textContent = text;
      };
      setCharge("primary", "primary-status", f.energy / 100, f.energy >= 38,
        f.energy >= 38 ? "READY" : `${Math.ceil(f.energy)}%`);
      setCharge("secondary", "secondary-status", 1 - f.ultimateCooldown / DUEL.ultimateCooldown,
        f.ultimateCooldown === 0, f.ultimateCooldown > 0 ? `${Math.ceil(f.ultimateCooldown)}s` : "READY");
      setCharge("shield", "shield-status", f.shieldLock > 0 ? 1 - f.shieldLock / DUEL.shieldBreak : f.shield / DUEL.shieldMax,
        f.shieldLock === 0 && f.shield >= DUEL.shieldMax - 0.5,
        f.shieldLock > 0 ? `${Math.ceil(f.shieldLock)}s` : f.shield >= DUEL.shieldMax - 0.5 ? "READY" : `${Math.ceil(f.shield)}%`);
      setCharge("ultimate", "charge", f.ultimateCharge / LOCAL_DUEL.ultimateDamage,
        f.ultimateCharge >= LOCAL_DUEL.ultimateDamage, f.ultimateCharge >= LOCAL_DUEL.ultimateDamage ? "READY" :
          `${Math.floor(f.ultimateCharge / LOCAL_DUEL.ultimateDamage * 100)}%`);
    }
    projectiles?.update(clock);
    projectiles?.pool.forEach((visual, i) => {
      const m = duel.missiles[i];
      visual.root.visible = !!m;
      if (!m) return;
      const index = m.owner === "hero" ? 0 : 1, side = characters[index];
      projectiles.style(visual, side, m.kind);
      const fighter = duel.fighters[index], mech = mechs[index];
      const spawn = point(fighter.x + fighter.facing * (m.kind === "round" ? 4.8 : m.kind === "bladeWave" ? 4.2 : 13.2),
        fighter.y + (m.kind === "bladeWave" ? 8.6 : 10.5));
      const muzzle = m.kind === "round" ? mech.getMuzzle() : mech.getBlade().tip.clone();
      const offset = muzzle.sub(spawn).multiplyScalar(Math.max(0, 1 - m.age / 0.12));
      visual.root.position.copy(point(m.x, m.y)).add(offset);
      const direction = point(m.x + m.vx, m.y + m.vy).sub(point(m.x, m.y)).normalize();
      visual.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      visual.root.scale.setScalar(scale);
      visual.wave.rotation.y = Math.sin(m.age * 4) * 0.08;
      visual.wave.scale.setScalar(0.85 + Math.min(0.25, m.age * 0.6));
      visual.flame.scale.setScalar(0.55 + Math.sin(m.age * 40) * 0.12);
      effects.projectile(visual.root.position, direction, side, clock, i);
    });
    frameCamera(enteredSpace ? 0 : dt);
  }
  function updateArena(dt: number) {
    if (!duel || !orbitalWorld || !effects || !bomb) return false;
    const state = duel.getState();
    const t = state.bombTime;
    const space = state.stage === "space";
    const enteredSpace = space && lastArenaStage !== state.stage;
    lastArenaStage = state.stage;
    if (enteredSpace) {
      transitionFade = 1;
      trails.forEach((trail) => trail.clear());
    } else transitionFade = Math.max(0, transitionFade - dt * 3);
    altitude = space ? SPACE_ALTITUDE : 0;
    ground.visible = !space;
    orbitalLights.visible = space;
    orbitalWorld.root.visible = space;
    if (space) {
      orbitalWorld.update(clock, 1, true, 0, -1, -1, 0, reducedMotion);
      orbitalWorld.floor.visible = false;
    }
    bomb.root.visible = state.phase === "bomb" && t < LOCAL_DUEL.bombImpact;
    if (state.phase === "bomb") {
      if (bomb.root.visible) {
        bomb.update(t, cinematicProgress(t, 0, 0.3), t / LOCAL_DUEL.bombImpact);
        bomb.root.position.copy(point(state.bombX ?? 0, 9));
        bomb.root.scale.setScalar(scale * (1 + t / LOCAL_DUEL.bombImpact * 0.3));
      }
      if (lastBombTime < LOCAL_DUEL.bombImpact && t >= LOCAL_DUEL.bombImpact) {
        const impact = point(state.bombX ?? 0, 9);
        effects.burst(impact, 6 * scale, 0xff7246, 140);
        effects.ring(impact, 15 * scale, 0xff6b40, true, 0.6);
        emitComicEffect(scene, "boom", { position: impact, size: 12 * scale });
        playSfx("explosion", 1);
        post?.impact();
      }
      lastBombTime = t;
    }
    const explosionFlash = state.phase === "bomb" && t >= LOCAL_DUEL.bombImpact
      ? Math.max(0.65 * (1 - cinematicProgress(t, LOCAL_DUEL.bombImpact, LOCAL_DUEL.bombImpact + 0.25)),
        cinematicProgress(t, LOCAL_DUEL.bombSeconds - 0.18, LOCAL_DUEL.bombSeconds)) : 0;
    get(".finale-local-flash").style.opacity = String(Math.max(explosionFlash, transitionFade) * (reducedMotion ? 0.35 : 1));
    hud.classList.toggle("transitioning", state.phase === "bomb");
    return enteredSpace;
  }
  function frameCamera(dt = 0) {
    const state = duel?.getState();
    const midpoint = duel ? (duel.fighters[0].x + duel.fighters[1].x) / 2 : 0;
    const spread = duel ? Math.abs(duel.fighters[1].x - duel.fighters[0].x) : 28;
    const focus = point(midpoint, duel ? (duel.fighters[0].y + duel.fighters[1].y) / 2 + 9 : 9);
    const vertical = duel ? Math.abs(duel.fighters[0].y - duel.fighters[1].y) + 24 : 24;
    const distance = Math.max(state?.stage === "space" ? 64 : 46,
      Math.max((spread + 30) / camera.aspect, vertical) /
      (1.55 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * scale;
    const offset = site ? new THREE.Vector3(0.2425356 * distance, distance * 0.22, 0.9701425 * distance) : new THREE.Vector3(0, distance * 0.22, distance);
    const target = focus.clone().add(offset);
    if (dt > 0) camera.position.lerp(target, 1 - Math.exp(-dt * 8)); else camera.position.copy(target);
    camera.lookAt(focus);
    site?.updateVisibility(camera);
  }
  frameCamera();
  const ready = Promise.all([site?.ready, ...mechs.map((mech) => mech.loaded)]).then(() => {
    if (disposed) return;
    for (const i of SIDES) if (duel) duel.setPaths(i, mechs[i].sampleAttackPaths(), mechs[i].samplePhysicalPaths());
    loaded = true;
    poseFighters(0);
    if (match) post = createFinaleRenderer(renderer, scene, camera, mobile);
  });
  return {
    scene, camera, player, ready, updatePhysics,
    ownsWeaponInput: true, ownsControllerInput: true, forceThirdPerson: true,
    isCinematic: () => true, hideCharacter: () => true, hideMinimap: () => true,
    getCinematicState: () => player.getState(),
    getPausePreviewModel: () => mechs[pausePlayer]?.root,
    getSceneId: () => "finaleArcade",
    getMusicTrack: () => match ? "final-battle" : "broken-chains",
    getCinematicDelta: () => 0,
    async prepareRendering() { await ready; await post?.prepare(); },
    clearInput() { previous.clear(); suspend(); },
    setMenuPaused(value: boolean) { paused = value; suspend(); },
    restartAtCheckpoint() {
      if (match && seats[0] && seats[1])
        leave(() => onMatch({ arena, characters: [...characters], controllers: [seats[0]!, seats[1]!] }));
      else leave(onSetup);
      return true;
    },
    renderSceneWithEffects() { if (post) post.render(); else renderer.render(scene, camera); },
    dispose() {
      if (disposed) return;
      disposed = true;
      events.abort();
      hud.remove();
      document.body.classList.remove("finale-active", "finale-local-active");
      post?.dispose();
      trails.forEach((trail) => trail.dispose());
      effects?.dispose();
      disposeComicEffects(scene);
      mechs.forEach((mech) => mech.dispose());
      markers.forEach((marker) => { marker.removeFromParent(); marker.material.dispose(); });
      markerGeometry.dispose();
      projectiles?.dispose();
      if (bomb) { bomb.root.removeFromParent(); disposeRoom(bomb.root); }
      orbitalWorld?.dispose();
      if (bay) disposeRoom(bay);
      player.dispose();
      physics.dispose();
      site?.dispose();
      scene.clear();
    },
  };
}
