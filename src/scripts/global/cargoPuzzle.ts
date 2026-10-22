export type CargoRoom = 9 | 10 | 11 | 12;
export type CargoLane = 10 | 11;
export interface CargoPosition { x: number; y: number; z: number; }
export interface CargoRecord {
  id: string; lane: CargoLane; room: CargoRoom; breakable: boolean;
  mode: 'belt' | 'parked'; slot: number; position: CargoPosition; moving?: boolean;
}
export interface CargoTransfer {
  id: string; position: CargoPosition; offset: CargoPosition;
}
export interface CargoPuzzleState {
  gravityRestored: boolean;
  gates: Record<CargoLane, boolean>;
  handle: 'missing' | 'loose' | 'carried' | 'installed';
  handlePosition: CargoPosition | null;
  shortcutUnlocked: boolean; revealed: boolean; revealShown: boolean; exitUnlocked: boolean;
  clock: number; alignment: number; feedBlocked: boolean; sequence: Record<CargoLane, number>;
  cargo: CargoRecord[];
}
export const CARGO = Object.freeze({ half: 0.7, beltTop: 0.18, sideBeltZ: 4.6, cycle: 6, pause: 3, speed: 1.25 });
export const PLATES = { 10: { x: 3.4, y: 0.025, z: -4.5 }, 11: { x: -3.4, y: 0.025, z: -4.5 }, 12: { x: 0, y: 0.025, z: 0 } } as const;
export const laneX = (lane: CargoLane, bay = false) => (lane === 10 ? -1 : 1) * (bay ? -7.8 : 3.6);
export function beltFraction(state: CargoPuzzleState) {
  return Math.max(0, (state.clock % CARGO.cycle - CARGO.pause) / (CARGO.cycle - CARGO.pause));
}
export function beltMoving(state: CargoPuzzleState) { return state.gravityRestored && !state.feedBlocked && state.alignment <= 0 && state.clock % CARGO.cycle >= CARGO.pause; }
export function cargoPosition(item: CargoRecord, state: CargoPuzzleState): CargoPosition {
  if (item.mode !== 'belt') return item.position;
  const progress = item.slot + beltFraction(state);
  if (item.room === 9) return { x: laneX(item.lane, true), y: 0.88 + (item.slot === 0 ? Math.max(0, 1 - (state.clock % 6) / 1.1) ** 2 * 7 : 0), z: 10.2 - progress * 3 };
  const t = progress - 8;
  return { x: (item.lane === 10 ? -1 : 1) * (5.2 - t * 2.8), y: 0.88 - Math.max(0, t - 3.3) ** 2 * 18, z: CARGO.sideBeltZ };
}
function spawn(state: CargoPuzzleState, lane: CargoLane, slot = 0) {
  const serial = ++state.sequence[lane];
  const item: CargoRecord = { id: `cargo-${lane}-${serial}`, lane, room: slot < 8 ? 9 : lane,
    breakable: lane === 11 && serial % 3 === 0, mode: 'belt', slot, position: { x: 0, y: 0.88, z: 0 } };
  item.position = cargoPosition(item, state); state.cargo.push(item); return item;
}
export function createCargoPuzzleState(preset?: number): CargoPuzzleState {
  const state: CargoPuzzleState = { gravityRestored: false, gates: { 10: false, 11: false }, handle: 'missing', handlePosition: null,
    shortcutUnlocked: false, revealed: false, revealShown: false, exitUnlocked: false, clock: 1.2, alignment: 0, feedBlocked: false,
    sequence: { 10: 0, 11: 0 }, cargo: [] };
  for (const lane of [10, 11] as const) for (let slot = 0; slot < 6; slot++) spawn(state, lane, slot);
  if (preset === 10 || preset === 11 || preset === 12) {
    state.gravityRestored = true;
    state.gates[10] = true; state.gates[11] = preset !== 10;
    if (preset !== 10) state.handle = 'installed';
    for (const lane of [10, 11] as const) for (let slot = 8; slot < 11; slot++) spawn(state, lane, slot);
    if (preset === 12) {
      state.shortcutUnlocked = state.revealed = state.revealShown = true;
      for (const lane of [10, 11] as const) {
        const item = spawn(state, lane, 8); item.mode = 'parked'; item.position = { ...PLATES[lane], y: 0.7 };
      }
      for (const [x, breakable] of [[-1.8, false], [1.8, true]] as const) {
        const item = spawn(state, 11); item.room = 12; item.mode = 'parked'; item.breakable = breakable;
        item.position = { x, y: 0.7, z: 3.5 };
      }
    }
  }
  return state;
}
/** Only the active puzzle scene advances this bounded, renderer-independent feed. */
export function advanceCargo(state: CargoPuzzleState, dt: number) {
  if (!state.gravityRestored) return;
  dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
  if (state.alignment > 0) { state.alignment = Math.max(0, state.alignment - dt); return; }
  const before = Math.floor(state.clock / CARGO.cycle), nextClock = state.clock + dt;
  const crossed = Math.floor(nextClock / CARGO.cycle) > before;
  const nextState = { ...state, clock: nextClock };
  const parked = state.cargo.filter(item => item.mode === 'parked');
  state.feedBlocked = state.cargo.some(item => {
    if (item.mode !== 'belt') return false;
    const slot = item.slot + (crossed ? 1 : 0), room = slot < 8 ? 9 : item.lane;
    const next = cargoPosition({ ...item, slot, room }, nextState);
    return parked.some(obstacle => obstacle.room === room &&
      Math.abs(obstacle.position.x - next.x) < 1.42 && Math.abs(obstacle.position.y - next.y) < 1.39 &&
      Math.abs(obstacle.position.z - next.z) < 1.42);
  });
  if (state.feedBlocked) return;
  state.clock = nextClock;
  if (crossed) {
    for (const item of state.cargo) if (item.mode === 'belt') { item.slot++; item.room = item.slot < 8 ? 9 : item.lane; }
    state.cargo = state.cargo.filter(item => item.mode !== 'belt' || item.slot < 12);
    for (const lane of [10, 11] as const) spawn(state, lane);
  }
  for (const item of state.cargo) if (item.mode === 'belt') item.position = cargoPosition(item, state);
}
export function plateCargo(state: CargoPuzzleState, room: 10 | 11 | 12) {
  const plate = PLATES[room];
  return state.cargo.find(item => item.room === room && item.mode === 'parked' && !item.moving &&
    Math.abs(item.position.x - plate.x) <= 0.48 && Math.abs(item.position.z - plate.z) <= 0.48 && Math.abs(item.position.y - 0.7) < 0.12);
}
export function removeCargo(state: CargoPuzzleState, id: string) { state.cargo = state.cargo.filter(item => item.id !== id); }
