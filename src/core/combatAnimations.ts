import * as THREE from 'three';
import combatUrl from '../assets/animations/quaterniusCombat.json?url';
import { fetchAsset } from './assetCache.js';

export const COMBAT_ANIMATION_URLS = [combatUrl];
type SerializedClip = Parameters<typeof THREE.AnimationClip.parse>[0];
type CombatSide = 'hero' | 'enemy';
interface BindPose { name: string; position: [number, number, number]; quaternion: [number, number, number, number]; }
interface CombatLibrary { version: number; rigs: Record<CombatSide, SerializedClip[]>; bindPoses: Record<CombatSide, BindPose[]>; }
interface PreparedLibrary { rigs: Record<CombatSide, THREE.AnimationClip[]>; bindPoses: CombatLibrary['bindPoses']; }
let prepared: Promise<PreparedLibrary> | null = null;

function concatenate(name: string, segments: readonly THREE.AnimationClip[]) {
  const channels = new Map<string, { times: number[]; values: number[]; quaternion: boolean }>();
  let offset = 0;
  for (const clip of segments) {
    for (const track of clip.tracks) {
      const channel = channels.get(track.name) ?? { times: [], values: [], quaternion: track instanceof THREE.QuaternionKeyframeTrack };
      const size = track.getValueSize();
      for (let frame = 0; frame < track.times.length; frame++) {
        const time = offset + track.times[frame];
        if (channel.times.length && time <= channel.times[channel.times.length - 1] + 1e-6) continue;
        channel.times.push(time);
        for (let axis = 0; axis < size; axis++) channel.values.push(track.values[frame * size + axis]);
      }
      channels.set(track.name, channel);
    }
    offset += clip.duration;
  }
  return new THREE.AnimationClip(name, offset, [...channels].map(([name, channel]) =>
    channel.quaternion ? new THREE.QuaternionKeyframeTrack(name, channel.times, channel.values)
      : new THREE.VectorKeyframeTrack(name, channel.times, channel.values))).optimize();
}

function prepareClips(serialized: SerializedClip[]) {
  const clips = serialized.map(clip => THREE.AnimationClip.parse(clip));
  const get = (name: string) => {
    const clip = clips.find(clip => clip.name === name);
    if (!clip) throw new Error(`Downloaded Quaternius combat clip is missing: ${name}`);
    if (clip.duration <= 0 || !Number.isFinite(clip.duration)) throw new Error(`Invalid combat clip duration: ${name}`);
    return clip;
  };
  clips.push(concatenate('Sword_Regular_A_WithRecovery', [get('Sword_Regular_A'), get('Sword_Regular_A_Rec')]));
  clips.push(concatenate('Sword_Regular_B_WithRecovery', [get('Sword_Regular_B'), get('Sword_Regular_B_Rec')]));
  clips.push(concatenate('Melee_Hook_WithRecovery', [get('Melee_Hook'), get('Melee_Hook_Rec')]));
  const slideLoop = new THREE.AnimationClip('Slide_Carry', 0.3,
    get('Slide_Loop').tracks.map(track => track.clone().trim(0, 0.3)));
  clips.push(concatenate('Slide_Tackle', [get('Slide_Start'), slideLoop, get('Slide_Exit')]));
  for (const name of ['Sword_Attack', 'Sword_Regular_C', 'Sword_Regular_Combo', 'Sword_Heavy_Combo', 'Sword_Dash', 'Sword_Block',
    'Punch_Jab', 'Punch_Cross']) get(name);
  return clips;
}

function prepareCombatAnimations() {
  if (!prepared) {
    prepared = fetchAsset(combatUrl).then(async response => {
      const data: CombatLibrary = await response.json();
      if (data.version !== 1 || !Array.isArray(data.rigs?.hero) || !Array.isArray(data.rigs?.enemy)
        || !Array.isArray(data.bindPoses?.hero) || !Array.isArray(data.bindPoses?.enemy))
        throw new Error('The imported Quaternius combat library has an invalid shape');
      for (const poses of Object.values(data.bindPoses)) {
        if (poses.length !== 4 || poses.some(pose => typeof pose.name !== 'string' || !Array.isArray(pose.position)
          || pose.position.length !== 3 || !Array.isArray(pose.quaternion) || pose.quaternion.length !== 4
          || [...pose.position, ...pose.quaternion].some(value => !Number.isFinite(value))))
          throw new Error('The combat library contains an invalid rig bind pose');
      }
      return { rigs: { hero: prepareClips(data.rigs.hero), enemy: prepareClips(data.rigs.enemy) }, bindPoses: data.bindPoses };
    }).catch(error => { prepared = null; throw error; });
  }
  return prepared;
}

export async function loadCombatAnimations(side: 'hero' | 'enemy') {
  return (await prepareCombatAnimations()).rigs[side].map(clip => clip.clone());
}

export async function loadCombatAnimationsForRig(model: THREE.Object3D) {
  const library = await prepareCombatAnimations();
  for (const side of ['hero', 'enemy'] as const) {
    const compatible = library.bindPoses[side].every(pose => {
      const bone = model.getObjectByName(pose.name);
      return bone && bone.position.distanceTo(new THREE.Vector3().fromArray(pose.position)) < 1e-4
        && Math.abs(bone.quaternion.dot(new THREE.Quaternion().fromArray(pose.quaternion).normalize())) > 1 - 1e-6;
    });
    if (compatible) return library.rigs[side].map(clip => clip.clone());
  }
  console.warn('[Combat animations] This custom rig has a different bind pose; retaining its own authored clips.');
  return [];
}

export async function preloadCombatAnimations() { await prepareCombatAnimations(); }
