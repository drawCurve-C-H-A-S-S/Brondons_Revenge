/** Reading time only: never apply this to QTEs, simulation or cinematic clocks. */
export const POPUP_EXTRA_SECONDS = 1;

export function popupDuration(seconds: number) {
  return seconds + POPUP_EXTRA_SECONDS;
}