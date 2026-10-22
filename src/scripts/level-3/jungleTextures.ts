import * as THREE from 'three';
import barkDiffuseUrl from '../../assets/textures/pine-bark-diff-2k.jpg?url';
import barkNormalUrl from '../../assets/textures/pine-bark-nor-1k.jpg?url';

let prepared: { bark: THREE.CanvasTexture; leaves: THREE.CanvasTexture; stone: THREE.CanvasTexture; needles: THREE.CanvasTexture; grass: THREE.CanvasTexture; pineBranch: THREE.CanvasTexture; grassTuft: THREE.CanvasTexture } | undefined;

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
      result.anisotropy = 2; return result;
    };
    const bark = texture(context => {
      context.fillStyle = '#4a3b2c'; context.fillRect(0, 0, 256, 256);
      for (let index = 0; index < 520; index++) {
        context.fillStyle = ['#5f4c39', '#33291e', '#54432f', '#2a2118'][index % 4];
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
      const greens = ['#1d4a22', '#256028', '#2f6b33', '#173a1c', '#3a7d3c', '#245628'];
      context.lineCap = 'round';
      // dark shadow needles underneath give the spray depth up close
      for (let index = 0; index < 500; index++) {
        const x = 8 + random() * 240, dir = index % 2 ? 1 : -1;
        const length = 14 + random() * 26, sweep = (random() - 0.5) * 2.4;
        context.strokeStyle = index % 3 ? '#14301a' : '#1d4423';
        context.lineWidth = 2.4 + random() * 2;
        context.beginPath(); context.moveTo(x, 128 + (random() - 0.5) * 8);
        context.lineTo(x + Math.sin(sweep) * length, 128 + dir * Math.cos(sweep) * length);
        context.stroke();
      }
      // mid-green needle mass so the spray reads solid, not see-through
      for (let index = 0; index < 380; index++) {
        const t = random(), x = 10 + t * 236;
        const spread = (1 - t * 0.5) * 24;
        context.fillStyle = greens[index % 6];
        context.globalAlpha = 0.8;
        context.beginPath();
        context.ellipse(x + (random() - 0.5) * 14, 128 + (random() - 0.5) * spread * 1.7, 2.5 + random() * 4, 1.8 + random() * 2.6, random() * Math.PI, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      // woody stem
      context.strokeStyle = '#4a3b2c'; context.lineWidth = 3.5;
      context.beginPath(); context.moveTo(4, 128); context.lineTo(252, 128); context.stroke();
      // feathery needles at chaotic angles, sweeping mostly toward the tip
      for (let index = 0; index < 900; index++) {
        const t = index / 900, x = 8 + t * 240 + (random() - 0.5) * 10;
        const dir = index % 2 ? 1 : -1;
        const length = (28 - 14 * t) * (0.5 + random() * 0.9);
        const sweep = (random() - 0.35) * 1.9;
        context.strokeStyle = greens[index % 6];
        context.lineWidth = 1.4 + random() * 1.4;
        context.beginPath(); context.moveTo(x, 128 + (random() - 0.5) * 6);
        context.lineTo(x + Math.sin(sweep) * length, 128 + dir * Math.cos(sweep) * length);
        context.stroke();
      }
      // sparse sunlit tips
      for (let index = 0; index < 120; index++) {
        const x = 10 + random() * 236, dir = index % 2 ? 1 : -1;
        const length = 10 + random() * 16, sweep = (random() - 0.3) * 1.4;
        context.strokeStyle = index % 2 ? '#4c8f45' : '#5aa04e';
        context.lineWidth = 1.2 + random();
        context.beginPath(); context.moveTo(x, 128 + (random() - 0.5) * 4);
        context.lineTo(x + Math.sin(sweep) * length, 128 + dir * Math.cos(sweep) * length);
        context.stroke();
      }
    });
    const grassTuft = texture(context => {
      context.clearRect(0, 0, 256, 256);
      context.lineCap = 'round';
      const blades = ['#5b8436', '#6a9440', '#7fa653', '#93b45f', '#4c7030', '#86a852'];
      // dense fan of thin curved blades rising from the bottom edge
      for (let index = 0; index < 34; index++) {
        const baseX = 10 + random() * 236;
        const height = 80 + random() * 165;
        const lean = (random() - 0.5) * 110;
        context.strokeStyle = blades[index % 6];
        context.lineWidth = 2 + random() * 2.6;
        context.beginPath(); context.moveTo(baseX, 258);
        context.quadraticCurveTo(baseX + lean * 0.22, 256 - height * 0.55, baseX + lean, 256 - height);
        context.stroke();
      }
      // sunlit pale tips catching the light
      for (let index = 0; index < 12; index++) {
        const baseX = 18 + random() * 220;
        const height = 110 + random() * 130;
        const lean = (random() - 0.5) * 80;
        context.strokeStyle = index % 3 ? '#b9cc6d' : '#c9d87e';
        context.lineWidth = 1.5 + random();
        context.beginPath(); context.moveTo(baseX, 258);
        context.quadraticCurveTo(baseX + lean * 0.3, 256 - height * 0.6, baseX + lean, 256 - height);
        context.stroke();
      }
    });
    for (const foliage of [leaves, needles, pineBranch, grassTuft]) {
      foliage.anisotropy = 1;
      foliage.minFilter = THREE.LinearMipmapLinearFilter;
      foliage.magFilter = THREE.LinearFilter;
    }
    prepared = { bark, leaves, stone, needles, grass, pineBranch, grassTuft };
  }
  return { bark: prepared.bark.clone(), leaves: prepared.leaves.clone(), stone: prepared.stone.clone(), needles: prepared.needles.clone(), grass: prepared.grass.clone(), pineBranch: prepared.pineBranch.clone(), grassTuft: prepared.grassTuft.clone() };
}

export function preloadJungleTextures() {
  Object.values(createJungleTextures()).forEach(texture => texture.dispose());
}

export const PHOTO_BARK_URLS = [barkDiffuseUrl, barkNormalUrl];

let photoBark: { diffuse: THREE.Texture; normal: THREE.Texture } | undefined;

export async function preloadPhotoBark() {
  if (!photoBark) {
    const loader = new THREE.TextureLoader();
    const load = (url: string) => new Promise<THREE.Texture>((resolve, reject) => { loader.load(url, resolve, undefined, reject); });
    const [diffuse, normal] = await Promise.all([load(barkDiffuseUrl), load(barkNormalUrl)]);
    diffuse.colorSpace = THREE.SRGBColorSpace;
    for (const map of [diffuse, normal]) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; }
    photoBark = { diffuse, normal };
  }
  return photoBark;
}

export function getPhotoBark() {
  return photoBark;
}
