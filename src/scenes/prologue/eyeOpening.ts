import * as THREE from 'three';

const WIDTH = 1840, HEIGHT = 560, EYES = [450, 1390];

/** The sclera, irises, eyebrows and hair all come from the captured player model. */
export function createEyeOpening(canvas: HTMLCanvasElement, photograph: CanvasImageSource) {
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The opening-eye sequence requires a 2D canvas');
  const closed = document.createElement('canvas'); closed.width = WIDTH; closed.height = HEIGHT;
  const closedContext = closed.getContext('2d');
  const hair = document.createElement('canvas'); hair.width = WIDTH; hair.height = HEIGHT;
  const hairContext = hair.getContext('2d');
  if (!closedContext || !hairContext) throw new Error('Unable to prepare Brondon eye photograph');
  closedContext.drawImage(photograph, 0, 0, WIDTH, HEIGHT);
  const lids = closedContext.getImageData(0, 0, WIDTH, HEIGHT), strands = hairContext.createImageData(WIDTH, HEIGHT);
  const eyePixels = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const index = (y * WIDTH + x) * 4, r = lids.data[index], g = lids.data[index + 1], b = lids.data[index + 2];
    const isHair = r > 145 && g > 140 && b < 195 && g > b * 1.15;
    if (isHair) {
      strands.data[index] = r; strands.data[index + 1] = g; strands.data[index + 2] = b; strands.data[index + 3] = 255;
    }
    const inSocket = y >= 145 && y < 480 && ((x > 140 && x < 690) || (x > 1150 && x < 1700));
    const sclera = r > 210 && Math.max(r, g, b) - Math.min(r, g, b) < 18;
    const iris = r > 35 && g < 45 && b > 20;
    const ink = r < 150 && g < 95 && b < 80;
    if (inSocket && !isHair && (sclera || iris || ink)) {
      eyePixels[y * WIDTH + x] = 1;
    }
  }
  // Extend the lid over antialiased eye edges so closed eyes have no iris outlines.
  for (let y = 145; y < 480; y++) for (const start of [140, 1150]) for (let x = start; x < start + 550; x++) {
    const index = (y * WIDTH + x) * 4;
    if (strands.data[index + 3]) continue;
    let covered = false;
    for (let dy = -2; dy <= 2 && !covered; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (eyePixels[(y + dy) * WIDTH + x + dx]) { covered = true; break; }
    }
    if (covered) {
      lids.data[index] = 234; lids.data[index + 1] = 193; lids.data[index + 2] = 175;
    }
  }
  closedContext.putImageData(lids, 0, 0); hairContext.putImageData(strands, 0, 0);
  for (const x of EYES) {
    closedContext.strokeStyle = '#521d0a'; closedContext.lineWidth = 8; closedContext.lineCap = 'round';
    closedContext.beginPath(); closedContext.moveTo(x - 220, 322);
    closedContext.quadraticCurveTo(x, 366, x + 220, 322); closedContext.stroke();
  }
  return {
    draw(elapsed: number) {
      context.save(); context.clearRect(0, 0, WIDTH, HEIGHT);
      const push = 1 + THREE.MathUtils.smootherstep(elapsed, 0, 4.8) * 0.035;
      context.translate(WIDTH / 2, HEIGHT / 2); context.scale(push, push); context.translate(-WIDTH / 2, -HEIGHT / 2);
      context.drawImage(closed, 0, 0);
      for (const [index, x] of EYES.entries()) {
        const time = elapsed - index * 0.08;
        const flutter = 0.08 * (THREE.MathUtils.smoothstep(time, 0.6, 0.9) - THREE.MathUtils.smoothstep(time, 1, 1.2));
        const blink = THREE.MathUtils.smoothstep(time, 2.55, 2.66) * (1 - THREE.MathUtils.smoothstep(time, 2.74, 2.94));
        const opening = THREE.MathUtils.clamp(
          (flutter + 0.58 * THREE.MathUtils.smootherstep(time, 1.25, 2.45)) * (1 - blink)
          + 0.42 * THREE.MathUtils.smootherstep(time, 2.95, 3.95), 0, 1);
        if (opening <= 0) continue;
        context.save(); context.beginPath(); context.moveTo(x - 275, 322);
        context.quadraticCurveTo(x, 322 - opening * 345, x + 275, 322);
        context.quadraticCurveTo(x, 322 + opening * 310, x - 275, 322);
        context.closePath(); context.clip(); context.drawImage(photograph, 0, 0, WIDTH, HEIGHT); context.restore();
      }
      const settled = THREE.MathUtils.smootherstep(elapsed, 3.95, 4.2);
      if (settled > 0) {
        context.globalAlpha = settled; context.drawImage(photograph, 0, 0, WIDTH, HEIGHT); context.globalAlpha = 1;
      }
      context.drawImage(hair, 0, 0);
      context.restore();
      context.strokeStyle = '#17191f'; context.lineWidth = 12; context.strokeRect(0, 0, WIDTH, HEIGHT);
    },
  };
}
