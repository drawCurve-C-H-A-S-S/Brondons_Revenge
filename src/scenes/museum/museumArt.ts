import * as THREE from "three";
import type { MuseumExhibit, PaintingTheme } from "./museumCatalog.js";

const W = 640,
  H = 400;
type Ctx = CanvasRenderingContext2D;

const PALETTE: Record<PaintingTheme, [string, string]> = {
  stealth: ["#0b1522", "#1d3550"],
  vents: ["#10161c", "#2a3a44"],
  cargo: ["#1c1710", "#4a3a22"],
  range: ["#0e1420", "#2a3550"],
  archive: ["#101a24", "#2c4660"],
  rust: ["#1c0e08", "#6a3416"],
  warden: ["#140a0a", "#4a1818"],
  escape: ["#0a1018", "#35506a"],
  flight: ["#02040c", "#0c1838"],
  jungle: ["#0a2a2a", "#1c5a2c"],
  facility: ["#04101a", "#0a3a52"],
  finale: ["#06060e", "#262a52"],
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function streaks(
  ctx: Ctx,
  t: number,
  seed: number,
  color: string,
  count = 60,
  speed = 260,
) {
  const random = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < count; i++) {
    const y = random() * H,
      x0 = random() * W,
      len = 14 + random() * 44,
      v = 0.4 + random() * 0.6;
    const x = ((((x0 - t * speed * v) % (W + 80)) + W + 80) % (W + 80)) - 40;
    ctx.globalAlpha = 0.3 + random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function glow(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

function ship(
  ctx: Ctx,
  x: number,
  y: number,
  s: number,
  color: string,
  flip = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -s : s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(40, 0);
  ctx.lineTo(-22, -22);
  ctx.lineTo(-10, 0);
  ctx.lineTo(-22, 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd27a";
  ctx.beginPath();
  ctx.arc(-14, 0, 5, 0, 7);
  ctx.fill();
  ctx.restore();
}

function corridor(ctx: Ctx, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (const [x, y] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(W / 2 + (x ? 70 : -70), H / 2 + (y ? 46 : -46));
    ctx.stroke();
  }
  ctx.strokeRect(W / 2 - 70, H / 2 - 46, 140, 92);
  ctx.strokeRect(W / 2 - 130, H / 2 - 86, 260, 172);
}

function mech(ctx: Ctx, t: number, body: string, eye: string, scale = 1) {
  ctx.save();
  ctx.translate(W / 2, H * 0.92);
  ctx.scale(scale, scale);
  ctx.fillStyle = body;
  ctx.fillRect(-60, -250, 120, 130);
  ctx.fillRect(-34, -300, 68, 50);
  ctx.fillRect(-120, -250, 56, 120);
  ctx.fillRect(64, -250, 56, 120);
  ctx.fillRect(-52, -120, 40, 120);
  ctx.fillRect(12, -120, 40, 120);
  const pulse = 0.6 + Math.sin(t * 4) * 0.4;
  glow(ctx, 0, -278, 54, eye, pulse);
  ctx.fillStyle = eye;
  ctx.fillRect(-22, -282, 44, 8);
  ctx.restore();
}

const MOTIFS: Record<PaintingTheme, (ctx: Ctx, t: number) => void> = {
  stealth(ctx, t) {
    corridor(ctx, "#3d6a94");
    const angle = Math.sin(t * 0.8) * 0.5;
    ctx.save();
    ctx.translate(W / 2, 90);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, "rgba(255,230,140,0.8)");
    g.addColorStop(1, "rgba(255,230,140,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-90, 270);
    ctx.lineTo(90, 270);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    glow(ctx, W / 2, 90, 22, "#ffe28a");
  },
  vents(ctx, t) {
    ctx.fillStyle = "#05080a";
    for (let i = 0; i < 9; i++) ctx.fillRect(40, 40 + i * 36, W - 80, 14);
    glow(ctx, 90 + ((t * 120) % 460), 200, 46, "#7fe0ff", 0.8);
  },
  cargo(ctx, t) {
    ctx.fillStyle = "#7a5a2c";
    for (let i = 0; i < 4; i++)
      for (let j = 0; j <= i; j++) {
        const x = 150 + i * 90 - j * 45 + (i === 3 ? Math.sin(t) * 3 : 0),
          y = 330 - i * 70 + (3 - i) * 0;
        ctx.fillRect(x, y - 60, 80, 60);
        ctx.strokeStyle = "#2a1c08";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y - 60, 80, 60);
      }
  },
  range(ctx, t) {
    for (let i = 5; i > 0; i--) {
      ctx.fillStyle = i % 2 ? "#e1e8e9" : "#38bcff";
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, i * 28 + Math.sin(t * 3) * 3, 0, 7);
      ctx.fill();
    }
    glow(
      ctx,
      W / 2 + Math.sin(t * 2) * 60,
      H / 2 + Math.cos(t * 2.4) * 40,
      20,
      "#ffe08a",
    );
  },
  archive(ctx, t) {
    ctx.fillStyle = "#071018";
    ctx.fillRect(60, 30, W - 120, H - 60);
    ctx.strokeStyle = "#38caff";
    ctx.lineWidth = 8;
    ctx.strokeRect(60, 30, W - 120, H - 60);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(W / 2, 150, 30, 0, Math.PI * 2);
    ctx.fill();
    const travel = (Math.sin(t * 2.5) + 1) / 2;
    const x = W / 2 + Math.sin(t * 1.2) * 80 * travel,
      y = 150 + travel * 180,
      radius = 8 + travel * 18;
    glow(ctx, x, y, radius * 2, "#c8ef35", 0.6);
    ctx.fillStyle = "#c8ef35";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.7, -1, 2);
    ctx.stroke();
    ctx.fillStyle = "#eefaff";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("BLOOMSTICK TENNIS / 20 IN A ROW", W / 2, 75);
  },
  rust(ctx, t) {
    const random = rng(11);
    for (let i = 0; i < 26; i++)
      glow(ctx, random() * W, random() * H, 30 + random() * 60, "#b4531c", 0.5);
    ctx.fillStyle = "#2a1608";
    ctx.fillRect(300, 0, 10, H);
    ctx.fillRect(360, 0, 10, H);
    for (let i = 0; i < 12; i++)
      ctx.fillRect(300, 20 + i * 34 + Math.sin(t) * 2, 70, 6);
  },
  escape(ctx, t) {
    ctx.fillStyle = "#d8e8f5";
    for (let i = 0; i < 8; i++)
      ctx.fillRect(40, 60 + ((i * 50 + t * 140) % 340), 560, 4);
    glow(ctx, W - 70, H / 2, 120, "#bfe4ff", 0.8);
  },
  jungle(ctx, t) {
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ["#1c5a34", "#17482a", "#0f3320"][layer];
      const random = rng(layer + 20);
      for (let i = 0; i < 14; i++) {
        const x = random() * W,
          h = 110 + random() * 110 + layer * 30;
        ctx.beginPath();
        ctx.moveTo(x - 36, H);
        ctx.lineTo(x, H - h);
        ctx.lineTo(x + 36, H);
        ctx.fill();
      }
    }
    ctx.strokeStyle = "rgba(220,245,255,0.8)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const x = 470 + i * 8,
        o = (t * 160 + i * 31) % 160;
      ctx.beginPath();
      ctx.moveTo(x, 70 + o);
      ctx.lineTo(x, 100 + o);
      ctx.stroke();
    }
  },
  facility(ctx, t) {
    ctx.strokeStyle = "#38c8ff";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      ctx.strokeRect(24 + i * 50, 40, 40, 320);
    }
    glow(ctx, 320, 200, 60, "#58e0ff", 0.6 + Math.sin(t * 3) * 0.3);
  },
  warden(ctx, t) {
    const phase = Math.floor(t / 2.5) % 4;
    mech(
      ctx,
      t,
      ["#2a2e36", "#2f2a36", "#38202a", "#3a1a1a"][phase],
      ["#ff4a3a", "#ff7a3a", "#ff9a2a", "#ff2a1a"][phase],
      1 + phase * 0.04,
    );
    if (phase === 3)
      glow(ctx, W / 2, H, 280, "#ff2a1a", 0.35 + Math.sin(t * 6) * 0.1);
  },
  flight(ctx, t) {
    const phase = Math.floor(t / 2.5) % 5;
    streaks(ctx, t, 3 + phase, phase === 2 ? "#ffb0b8" : "#cfe8ff", 60);
    ship(ctx, W / 2 - 120, H / 2 + Math.sin(t * 1.6) * 16, 2.6, "#9bd0ff");
    if (phase === 0) ship(ctx, 480, 110, 1.2, "#ff7a6a", true);
    if (phase === 1)
      glow(ctx, 480, 190 + Math.sin(t * 2) * 24, 90, "#33ff7a", 0.9);
    if (phase === 2) {
      ctx.fillStyle = "#2a3452";
      ctx.fillRect(330, 150, 260, 90);
      for (let i = 0; i < 4; i++)
        glow(
          ctx,
          370 + i * 64,
          195,
          34 + Math.sin(t * 5 + i) * 6,
          "#ffd23a",
          0.95,
        );
    }
    if (phase === 3)
      glow(ctx, 470, 200, 110 + Math.sin(t * 4) * 12, "#ff2040", 1);
    if (phase === 4) {
      const k = (t * 0.35) % 1;
      glow(ctx, 80 + k * 360, 40 + k * 250, 70, "#ffb050", 1);
    }
  },
  finale(ctx, t) {
    const phase = Math.floor(t / 2.5) % 3;
    mech(
      ctx,
      t,
      "#2c3254",
      ["#7aa8ff", "#ffb04a", "#ffffff"][phase],
      1 - phase * 0.1,
    );
    ctx.strokeStyle = "#aac8ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(60 + Math.sin(t * 9) * 8, 0);
    ctx.lineTo(120, 160);
    ctx.lineTo(80, 400);
    ctx.stroke();
    if (phase === 1)
      glow(ctx, W / 2, 300, 120 + Math.sin(t * 6) * 20, "#ff7a1a", 0.9);
    if (phase === 2) {
      const r = 150 - ((t * 60) % 110);
      ctx.strokeStyle = "#7aa8ff";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, 7);
      ctx.stroke();
    }
  },
};

/** An animated painted "feed" for one stage. Redrawn only while the visitor is close. */
export function createPainting(exhibit: MuseumExhibit) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const [top, bottom] = PALETTE[exhibit.theme];
  function redraw(t: number) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    MOTIFS[exhibit.theme](ctx, t);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    const v = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.4,
      W / 2,
      H / 2,
      H * 0.95,
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, H - 54, W, 54);
    ctx.fillStyle = "#f4e6bd";
    ctx.font = "bold 28px Georgia, serif";
    ctx.textAlign = "left";
    ctx.fillText(exhibit.title, 20, H - 22);
    if (Math.floor(t * 1.5) % 2 === 0) {
      ctx.fillStyle = "#ff3a3a";
      ctx.beginPath();
      ctx.arc(26, 26, 7, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px monospace";
    ctx.fillText("LIVE", 42, 31);
    texture.needsUpdate = true;
  }
  redraw(0);
  return { texture, redraw, dispose: () => texture.dispose() };
}

/** Hanging cloth banner: woven red fabric, gold trim and fringe, and the title in gold. */
export function createBannerTexture(text: string, width = 2048, height = 320) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const cloth = ctx.createLinearGradient(0, 0, 0, height);
  cloth.addColorStop(0, "#8c1620");
  cloth.addColorStop(1, "#5e0c14");
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, width, height - 36);
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = "#000";
  for (let x = 0; x < width; x += 6) ctx.fillRect(x, 0, 2, height - 36);
  for (let y = 0; y < height - 36; y += 6) ctx.fillRect(0, y, width, 2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#e2b84e";
  ctx.lineWidth = 8;
  ctx.strokeRect(22, 22, width - 44, height - 36 - 44);
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, width - 72, height - 36 - 72);
  ctx.fillStyle = "#e2b84e";
  for (let x = 6; x < width; x += 22) ctx.fillRect(x, height - 36, 10, 34);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = "#f6dc8a";
  const [title, subtitle] = text.split(/\s+-\s+/),
    clothHeight = height - 36;
  if (subtitle) {
    ctx.font = `bold ${Math.round(clothHeight * 0.42)}px Georgia, serif`;
    ctx.fillText(title, width / 2, clothHeight * 0.36, width - 160);
    ctx.font = `bold ${Math.round(clothHeight * 0.24)}px Georgia, serif`;
    ctx.fillText(subtitle, width / 2, clothHeight * 0.74, width - 160);
  } else {
    ctx.font = `bold ${Math.round(clothHeight * 0.4)}px Georgia, serif`;
    ctx.fillText(text, width / 2, clothHeight / 2 + 4, width - 160);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Comic-book title logo: thick ink outline, hard offset shadow and a yellow/red fill. */
export function createLogoTexture(width = 2048, height = 640) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const lines: Array<[string, string, number]> = [
    ["BRONDON'S", "#ffd23a", 175],
    ["REVENGE", "#e8262d", 455],
  ];
  lines.forEach(([text, fill, y], index) => {
    ctx.font = `${index ? 330 : 270}px Impact, Haettenschweiler, 'Franklin Gothic Heavy', sans-serif`;
    ctx.fillStyle = "#f4ecd8";
    ctx.fillText(text, width / 2 + 18, y + 20, width - 120);
    ctx.fillStyle = "#0b0b10";
    ctx.fillText(text, width / 2 + 12, y + 13, width - 120);
    ctx.lineWidth = 26;
    ctx.strokeStyle = "#0b0b10";
    ctx.strokeText(text, width / 2, y, width - 120);
    ctx.fillStyle = fill;
    ctx.fillText(text, width / 2, y, width - 120);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Comic-book caption: ink outline, hard offset shadow, yellow fill on a red burst. */
export function createComicLabel(text: string, width = 512, height = 160) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.lineJoin = "round";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0b0b10";
  ctx.fillRect(14, 18, width - 14, height - 18);
  ctx.fillStyle = "#e8262d";
  ctx.fillRect(4, 4, width - 18, height - 22);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#0b0b10";
  ctx.strokeRect(4, 4, width - 18, height - 22);
  let size = 88;
  ctx.font = `${size}px Impact, Haettenschweiler, 'Franklin Gothic Heavy', sans-serif`;
  while (ctx.measureText(text).width > width - 80 && size > 24) {
    size -= 4;
    ctx.font = `${size}px Impact, Haettenschweiler, sans-serif`;
  }
  const cx = (width - 14) / 2,
    cy = (height - 18) / 2 + 2;
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#0b0b10";
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = "#ffd23a";
  ctx.fillText(text, cx, cy);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Engraved gold-on-stone text for plaques and the frieze. */
export function createTextTexture(
  lines: string[],
  width: number,
  height: number,
  {
    size = 40,
    color = "#f4dd9a",
    background = "rgba(0,0,0,0)",
    font = "Georgia, serif",
  } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${size}px ${font}`;
  const step = height / (lines.length + 1);
  lines.forEach((line, i) => ctx.fillText(line, width / 2, step * (i + 1)));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
