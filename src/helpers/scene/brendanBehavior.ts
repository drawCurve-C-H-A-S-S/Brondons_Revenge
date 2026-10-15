import * as THREE from 'three';

export type BrendanActivity = 'idle' | 'walk' | 'talk' | 'ambient';

export function createBrendanBehavior(root: THREE.Group, model: THREE.Object3D, clips: THREE.AnimationClip[],
  pod: THREE.Vector3) {
  const mixer = new THREE.AnimationMixer(model);
  function action(name: string) {
    const clip = clips.find(clip => clip.name === name);
    if (!clip) throw new Error(`Brendan requires the ${name} animation`);
    return mixer.clipAction(clip);
  }
  const idle = action('Idle_Loop'), walk = action('Walk_Loop');
  const talk = action('Idle_Talking_Loop'), inspect = action('Interact');
  const actions = { idle, walk, talk, inspect };
  let current = idle, activity: BrendanActivity = 'idle';
  let destination = -1, waiting = 0;
  // Stay on the open south side of the wreck, clear of its rotated hull and the shuttle.
  const stops = [
    new THREE.Vector3(pod.x - 2.5, 0, pod.z + 3.8),
    new THREE.Vector3(pod.x + 2.5, 0, pod.z + 3.8),
    new THREE.Vector3(pod.x - 1.5, 0, pod.z + 5.5),
    new THREE.Vector3(pod.x + 1.5, 0, pod.z + 5.5),
  ];
  const delta = new THREE.Vector3();
  idle.play(); mixer.update(0);
  function play(next: THREE.AnimationAction) {
    if (next === current) return;
    current.fadeOut(0.25);
    current = next.reset().fadeIn(0.25).play();
  }
  function face(x: number, z: number, dt: number) {
    const yaw = Math.atan2(x - root.position.x, z - root.position.z);
    root.rotation.y += Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y))
      * Math.min(1, dt * 5);
  }
  return {
    setActivity(next: BrendanActivity) {
      if (activity === next) return;
      activity = next;
      if (next === 'ambient') { destination = -1; waiting = 0; }
      else play(actions[next]);
    },
    update(dt: number, viewer?: { x: number; z: number }) {
      if (activity === 'ambient') {
        if (waiting > 0) {
          waiting = Math.max(0, waiting - dt);
          face(pod.x, pod.z, dt);
        } else {
          if (destination < 0 || root.position.distanceTo(stops[destination]) < 0.02) {
            if (destination >= 0) {
              waiting = 3 + Math.random() * 4;
              play(Math.random() < 0.65 ? inspect : idle);
            }
            const previous = destination;
            destination = previous < 0 ? Math.floor(Math.random() * stops.length)
              : (previous + 1 + Math.floor(Math.random() * (stops.length - 1))) % stops.length;
          }
          if (!waiting) {
            delta.subVectors(stops[destination], root.position);
            const distance = delta.length();
            face(stops[destination].x, stops[destination].z, dt);
            root.position.addScaledVector(delta, Math.min(distance, dt * 0.75) / Math.max(distance, 0.001));
            play(walk);
          }
        }
      } else if (activity === 'talk' && viewer) face(viewer.x, viewer.z, dt);
      mixer.update(dt);
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); },
  };
}
