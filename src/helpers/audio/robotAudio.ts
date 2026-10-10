import * as THREE from 'three';

/**
 * Shared robot sound effects for beep-boop chatter.
 * Used by both stealth stage patrol bots and stage 2 robots.
 */
export function playRobotChatter(
  audioContext: AudioContext,
  audioMaster: GainNode,
  camera: THREE.Camera,
  robotPosition: THREE.Vector3,
  robotIndex: number = 0
) {
  if (!audioContext || audioContext.state !== 'running') return;
  
  const dx = robotPosition.x - camera.position.x;
  const dz = robotPosition.z - camera.position.z;
  const distance = Math.hypot(dx, dz);
  
  // Stereo panning based on robot position relative to camera
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const pan = audioContext.createStereoPanner();
  pan.pan.value = THREE.MathUtils.clamp((dx * right.x + dz * right.z) / Math.max(1, distance), -0.85, 0.85);
  pan.connect(audioMaster);
  
  // Different note patterns for different robots
  const notes = robotIndex === 0 ? [830, 510, 970] : [610, 1060, 690, 460];
  const context = audioContext;
  
  notes.forEach((frequency, note) => {
    const start = context.currentTime + note * 0.14;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.6, start + 0.12);
    gain.gain.setValueAtTime(0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
    oscillator.connect(gain);
    gain.connect(pan);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      if (note === notes.length - 1) pan.disconnect();
    };
  });
}

/**
 * Creates a robot chatter scheduler that periodically plays sounds.
 */
export function createRobotChatterScheduler(
  audioContext: () => AudioContext | null,
  audioMaster: () => GainNode | null,
  camera: () => THREE.Camera,
  getRobots: () => Array<{ position: THREE.Vector3 }>
) {
  let nextChatter = 0;
  let chattingBot = 0;
  
  return {
    update(elapsed: number, active: boolean) {
      if (!active || !audioContext() || !audioMaster()) return;
      
      if (elapsed >= nextChatter) {
        const robots = getRobots();
        if (robots.length > 0) {
          const bot = robots[chattingBot % robots.length];
          playRobotChatter(audioContext()!, audioMaster()!, camera(), bot.position, chattingBot % 2);
          chattingBot = 1 - chattingBot;
          nextChatter = elapsed + 1.8;
        }
      }
    },
    
    reset() {
      nextChatter = 0;
      chattingBot = 0;
    }
  };
}
