import { createFinaleQte, createMechDuel, type DuelEvent, type QteEvent } from './mechDuel.js';
import { HERO_TRANSFORM, PLANET_RUPTURE } from './finaleChoreography.js';

export type FinaleStart = 'reveal' | 'ground' | 'space' | 'finisher';
export type FinalePhase = 'loading' | 'error' | FinaleStart | 'enemyTransform' | 'heroTransform' | 'versus' | 'rupture' | 'defeat' | 'victory' | 'credits' | 'done';
export interface FinaleCheckpoint { stage: FinaleStart; }
export interface FinaleCue { phase: FinalePhase; id: string; at: number; }
export const FINALE_DURATION = Object.freeze({
  reveal: 27, enemyTransform: 19.2, heroTransform: 17, versus: 4.6, rupture: 16, defeat: 6, victory: 18, credits: 48,
});
export const FINALE_CUES: readonly FinaleCue[] = [
  { phase: 'reveal', id: 'lights', at: 2 }, { phase: 'reveal', id: 'pose', at: 21.2 },
  { phase: 'reveal', id: 'quintet-title', at: 23 },
  { phase: 'enemyTransform', id: 'roof-blast', at: 0.25 }, { phase: 'enemyTransform', id: 'prime-shield', at: 0.6 },
  { phase: 'enemyTransform', id: 'fireworks', at: 0.4 }, { phase: 'enemyTransform', id: 'enemy-frame', at: 3.2 },
  { phase: 'enemyTransform', id: 'five-cores', at: 17 }, { phase: 'enemyTransform', id: 'enemy-lock', at: 17.6 },
  { phase: 'heroTransform', id: 'prime-beacon', at: HERO_TRANSFORM.launch },
  { phase: 'heroTransform', id: 'ship-disassemble', at: HERO_TRANSFORM.disassemble },
  { phase: 'heroTransform', id: 'hero-frame', at: HERO_TRANSFORM.materialize },
  { phase: 'heroTransform', id: 'hero-boarding', at: HERO_TRANSFORM.pilotMerge },
  { phase: 'heroTransform', id: 'hero-sword', at: HERO_TRANSFORM.sword },
  { phase: 'heroTransform', id: 'hero-lock', at: HERO_TRANSFORM.lock },
  { phase: 'versus', id: 'fight', at: 3.7 },
  { phase: 'rupture', id: 'planet-breaker', at: PLANET_RUPTURE.release },
  { phase: 'rupture', id: 'escape-boost', at: PLANET_RUPTURE.escape },
  { phase: 'rupture', id: 'world-crack', at: PLANET_RUPTURE.impact },
  { phase: 'rupture', id: 'planet-burst', at: PLANET_RUPTURE.burst },
  { phase: 'rupture', id: 'orbit-lock', at: PLANET_RUPTURE.orbit },
  { phase: 'defeat', id: 'execution', at: 1.8 }, { phase: 'defeat', id: 'signal-flatline', at: 4.2 },
  { phase: 'victory', id: 'reactor-cut', at: 0.3 }, { phase: 'victory', id: 'quintet-burst', at: 3.2 },
  { phase: 'victory', id: 'donus-restored', at: 9.2 }, { phase: 'victory', id: 'the-end', at: 14 },
];

export function createFinaleDirector(start: FinaleStart = 'reveal') {
  const duel = createMechDuel(start === 'finisher' ? 'finisher' : start === 'space' ? 'space' : 'ground');
  const qte = createFinaleQte();
  let phase: FinalePhase = 'loading', phaseTime = 0, time = 0, paused = false, assetsReady = false, error = '';
  let checkpoint: FinaleStart = start, failure = '', skipHold = 0, skipDown = false, ended = false;
  const cues: FinaleCue[] = [], changes: FinalePhase[] = [], duelEvents: DuelEvent[] = [], qteEvents: QteEvent[] = [];
  function clearInput() { duel.clearInput(); qte.clearInput(); skipHold = 0; skipDown = false; }
  function change(next: FinalePhase) {
    phase = next; phaseTime = 0; clearInput(); changes.push(next);
    if (next === 'ground' || next === 'space' || next === 'finisher') checkpoint = next;
  }
  function fail(text: string) {
    if (phase === 'defeat' || phase === 'victory' || phase === 'credits' || phase === 'done') return;
    failure = text; change('defeat');
  }
  function tickCinematic(dt: number) {
    if (phase === 'reveal' || phase === 'enemyTransform' || phase === 'heroTransform') {
      skipHold = skipDown ? skipHold + dt : 0;
      if (skipHold >= 1.25) { change('versus'); return; }
    }
    if (phase === 'reveal' && phaseTime >= FINALE_DURATION.reveal) change('enemyTransform');
    else if (phase === 'enemyTransform' && phaseTime >= FINALE_DURATION.enemyTransform) change('heroTransform');
    else if (phase === 'heroTransform' && phaseTime >= FINALE_DURATION.heroTransform) change('versus');
    else if (phase === 'versus' && phaseTime >= FINALE_DURATION.versus) change('ground');
    else if (phase === 'rupture' && phaseTime >= FINALE_DURATION.rupture) { duel.enterSpace(); change('space'); }
    else if (phase === 'victory' && phaseTime >= FINALE_DURATION.victory) change('credits');
    else if (phase === 'credits' && phaseTime >= FINALE_DURATION.credits) { ended = true; change('done'); }
  }
  return {
    duel, qte, clearInput,
    assetsLoaded() { if (phase === 'loading') { assetsReady = true; change(start === 'ground' ? 'versus' : start); } },
    assetsFailed(reason: string) { error = reason; change('error'); },
    pause(value: boolean) { paused = value; clearInput(); },
    holdSkip(value: boolean) { if (!paused) skipDown = value; },
    update(dt: number, combatScale = 1) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(combatScale) || combatScale < 0) {
        throw new RangeError('Finale timing requires finite, nonnegative values');
      }
      if (paused || !assetsReady || phase === 'error' || phase === 'done') return;
      dt = Math.min(dt, 0.1);
      const before = phaseTime; time += dt; phaseTime += dt;
      for (const cue of FINALE_CUES) if (cue.phase === phase && before < cue.at && phaseTime >= cue.at) cues.push(cue);
      if (phase === 'ground' || phase === 'space') {
        duel.update(dt * Math.min(combatScale, 1));
        duelEvents.push(...duel.drainEvents());
        const state = duel.getState();
        if (state.phase === 'rupture') change('rupture');
        else if (state.phase === 'finisher') change('finisher');
        else if (state.phase === 'lost') fail('The Quintet breached the cockpit. Brondon was killed.');
      } else if (phase === 'finisher') {
        qte.update(dt); qteEvents.push(...qte.drainEvents());
        const result = qte.getState();
        if (result.result === 'won') { duel.finish(true); change('victory'); }
        else if (result.result === 'lost') {
          duel.finish(false);
          fail(result.failure === 'wrong-input' ? 'The wrong move exposed the cockpit. The students killed Brondon.'
            : 'The final counter was too late. The students killed Brondon.');
        }
      } else tickCinematic(dt);
    },
    drainCues() { return cues.splice(0); }, drainChanges() { return changes.splice(0); },
    drainDuelEvents() { return duelEvents.splice(0); }, drainQteEvents() { return qteEvents.splice(0); },
    getCheckpoint: (): FinaleCheckpoint => ({ stage: checkpoint }),
    getState: () => ({ phase, phaseTime, time, paused, assetsReady, error, failure, skipHold, ended }),
  };
}
