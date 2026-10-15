import { readFileSync } from 'node:fs';

const combatData = readFileSync(new URL('../src/assets/animations/quaterniusCombat.json', import.meta.url), 'utf8');

export function mockCombatAnimationFetch(t) {
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => String(url).includes('quaterniusCombat.json')
    ? Promise.resolve(new Response(combatData, { headers: { 'Content-Type': 'application/json' } }))
    : originalFetch(url, options));
}

export async function combatAnimationClips(t, server, side = 'hero') {
  mockCombatAnimationFetch(t);
  const { loadCombatAnimations } = await server.ssrLoadModule('/core/combatAnimations.ts');
  return loadCombatAnimations(side);
}
