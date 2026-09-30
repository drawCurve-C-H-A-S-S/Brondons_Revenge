import { createScene as createLoadingBay } from './scene13.js';

type Options = Omit<NonNullable<Parameters<typeof createLoadingBay>[0]>, 'checkpoint' | 'startAtPhaseThree' | 'onPhaseThree' | 'defeated'>;

export function createScene(options: Options = {}) {
  return { ...createLoadingBay({ ...options, defeated: false, checkpoint: true, startAtPhaseThree: true }), roomId: 'scene13.5' };
}