import * as THREE from 'three';

let prepared: { bark: THREE.CanvasTexture; leaves: THREE.CanvasTexture; stone: THREE.CanvasTexture } | undefined;

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
    prepared = { bark, leaves, stone };
  }
  return { bark: prepared.bark.clone(), leaves: prepared.leaves.clone(), stone: prepared.stone.clone() };
}

export function preloadJungleTextures() {
  Object.values(createJungleTextures()).forEach(texture => texture.dispose());
}
