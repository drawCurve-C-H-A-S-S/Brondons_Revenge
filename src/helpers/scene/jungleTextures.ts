import * as THREE from 'three';

let prepared: { bark: THREE.CanvasTexture; leaves: THREE.CanvasTexture; stone: THREE.CanvasTexture; needles: THREE.CanvasTexture; grass: THREE.CanvasTexture; pineBranch: THREE.CanvasTexture } | undefined;

export function createJungleTextures() {
  if (!prepared) {
    let seed = 7319;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const texture = (paint: (context: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Jungle surfaces require a 2D canvas');
      paint(context);
      const result = new THREE.CanvasTexture(canvas);
      result.colorSpace = THREE.SRGBColorSpace; result.wrapS = result.wrapT = THREE.RepeatWrapping;
      result.anisotropy = 4; return result;
    };
    const bark = texture(context => {
      context.fillStyle = '#695641'; context.fillRect(0, 0, 256, 256);
      for (let index = 0; index < 450; index++) {
        context.fillStyle = index % 3 ? '#89735a' : '#3b392c';
        context.fillRect(random() * 256, random() * 256, 1 + random() * 3, 8 + random() * 90);
      }
    });
    const leaves = texture(context => {
      context.fillStyle = '#29442a'; context.fillRect(0, 0, 256, 256);
      for (let index = 0; index < 260; index++) {
        context.save(); context.translate(random() * 256, random() * 256); context.rotate(random() * Math.PI * 2);
        const length = 9 + random() * 20, width = length * 0.3;
        context.fillStyle = ['#718b4e', '#4c733e', '#93a765', '#365f35'][index % 4];
        context.beginPath(); context.moveTo(0, -length / 2);
        context.quadraticCurveTo(width, 0, 0, length / 2); context.quadraticCurveTo(-width, 0, 0, -length / 2); context.fill();
        context.strokeStyle = '#b4bf83'; context.globalAlpha = 0.3; context.lineWidth = 0.7;
        context.beginPath(); context.moveTo(0, -length / 2); context.lineTo(0, length / 2); context.stroke();
        context.restore();
      }
    });
    const stone = texture(context => {
      context.fillStyle = '#a2a18c'; context.fillRect(0, 0, 256, 256);
      for (let index = 0; index < 2400; index++) {
        context.fillStyle = index % 4 ? '#c0baa4' : '#6e7760';
        context.globalAlpha = 0.25 + random() * 0.3;
        context.fillRect(random() * 256, random() * 256, 1 + random() * 5, 1 + random() * 4);
      }
      context.globalAlpha = 1;
    });
    const needles = texture(context => {
      context.fillStyle = '#1c3a22'; context.fillRect(0, 0, 256, 256);
      for (let index = 0; index < 900; index++) {
        context.save(); context.translate(random() * 256, random() * 256); context.rotate(random() * Math.PI * 2);
        context.strokeStyle = ['#2f5a34', '#3f6b3a', '#22492a', '#4a7a44', '#1a3a20'][index % 5];
        context.lineWidth = 0.8 + random() * 1.4;
        const length = 8 + random() * 24;
        context.beginPath(); context.moveTo(0, 0); context.lineTo(0, length); context.stroke();
        context.restore();
      }
    });
    const grass = texture(context => {
      context.fillStyle = '#6f8f4a'; context.fillRect(0, 0, 256, 256);
      for (let index = 0; index < 3200; index++) {
        context.strokeStyle = ['#5d7c3c', '#7fa054', '#4c6a30', '#8bb061'][index % 4];
        context.globalAlpha = 0.4 + random() * 0.4;
        const x = random() * 256, y = random() * 256, height = 3 + random() * 8;
        context.lineWidth = 0.7 + random();
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + (random() - 0.5) * 3, y - height); context.stroke();
      }
      context.globalAlpha = 1;
    });
    const pineBranch = texture(context => {
      context.clearRect(0, 0, 256, 256);
      const greens = ['#2c6a31', '#3a7d3a', '#245628', '#4a8f43', '#57a04c', '#1d4a22'];
      // dense needle mass first so the spray reads solid, not see-through
      for (let index = 0; index < 420; index++) {
        const t = random(), x = 10 + t * 236;
        const spread = (1 - t * 0.5) * 26;
        context.fillStyle = greens[index % 6];
        context.globalAlpha = 0.85;
        context.beginPath();
        context.ellipse(x + (random() - 0.5) * 14, 128 + (random() - 0.5) * spread * 1.7, 3 + random() * 5, 2 + random() * 3, random() * Math.PI, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      // woody stem over the mass
      context.lineCap = 'round';
      context.strokeStyle = '#5a4630'; context.lineWidth = 4;
      context.beginPath(); context.moveTo(4, 128); context.lineTo(252, 128); context.stroke();
      context.strokeStyle = '#6d5638'; context.lineWidth = 2;
      context.beginPath(); context.moveTo(4, 127); context.lineTo(252, 127); context.stroke();
      // feathery needles fanning up and down, sweeping toward the tip
      for (let index = 0; index < 950; index++) {
        const t = index / 950, x = 8 + t * 240 + (random() - 0.5) * 8;
        const dir = index % 2 ? 1 : -1;
        const length = (30 - 16 * t) * (0.6 + random() * 0.7);
        const sweep = 0.35 + random() * 0.75;
        context.strokeStyle = greens[index % 6];
        context.lineWidth = 1.6 + random() * 1.5;
        context.beginPath(); context.moveTo(x, 128 + (random() - 0.5) * 5);
        context.lineTo(x + Math.sin(sweep) * length * 0.8, 128 + dir * Math.cos(sweep) * length);
        context.stroke();
      }
    });
    prepared = { bark, leaves, stone, needles, grass, pineBranch };
  }
  return { bark: prepared.bark.clone(), leaves: prepared.leaves.clone(), stone: prepared.stone.clone(), needles: prepared.needles.clone(), grass: prepared.grass.clone(), pineBranch: prepared.pineBranch.clone() };
}

export function preloadJungleTextures() {
  Object.values(createJungleTextures()).forEach(texture => texture.dispose());
}
