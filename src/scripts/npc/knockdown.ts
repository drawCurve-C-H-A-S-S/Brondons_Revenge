import { MathUtils } from "three";

export const KNOCKDOWN_DURATION = 1.6;

export function knockdownTilt(remaining: number) {
  const elapsed = KNOCKDOWN_DURATION - remaining;
  return (
    1.3 *
    MathUtils.smoothstep(elapsed, 0, 0.18) *
    (1 -
      MathUtils.smoothstep(
        elapsed,
        KNOCKDOWN_DURATION - 0.4,
        KNOCKDOWN_DURATION,
      ))
  );
}
