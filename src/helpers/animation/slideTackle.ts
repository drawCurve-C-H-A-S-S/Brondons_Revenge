import { MathUtils } from 'three';

export const SLIDE_TACKLE = Object.freeze({ duration: 1.4, recovery: 0.86, cooldown: 0.25 });

export function slideTackleMotion(time: number) {
  const drop = MathUtils.smootherstep(time, 0.04, 0.3);
  const recover = MathUtils.smootherstep(time, SLIDE_TACKLE.recovery, SLIDE_TACKLE.duration);
  return {
    low: drop * (1 - recover),
    recover,
    eyeHeight: MathUtils.lerp(1.6, 0.82, drop * (1 - recover)),
  };
}

export function slideTackleSpeed(time: number, entrySpeed: number, exitSpeed: number) {
  const peak = Math.max(7.4, entrySpeed + 1.4);
  if (time < 0.14) return MathUtils.lerp(entrySpeed, peak, MathUtils.smootherstep(time, 0, 0.14));
  if (time < SLIDE_TACKLE.recovery) {
    return MathUtils.lerp(peak, 1.6, MathUtils.smoothstep(time, 0.14, SLIDE_TACKLE.recovery));
  }
  return MathUtils.lerp(1.6, exitSpeed, MathUtils.smootherstep(time, SLIDE_TACKLE.recovery, SLIDE_TACKLE.duration));
}
