const files = import.meta.glob<string>("../../assets/sounds/foley/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});

function clips(...names: string[]) {
  return names.map((name) => {
    const url = files[`../../assets/sounds/foley/${name}.ogg`];
    if (!url) throw new Error(`Missing recorded sound: ${name}`);
    return url;
  });
}

export const RECORDED_SOUNDS = {
  robotStep: clips("robot-step-1", "robot-step-2", "robot-step-3"),
  mechStep: clips("mech-step-1", "mech-step-2", "mech-step-3"),
  swordClash: clips("sword-clash-1", "sword-clash-2", "sword-clash-3"),
  woodBreak: clips("wood-break-1", "wood-break-2", "wood-break-3"),
  glassBreak: clips("glass-break-1", "glass-break-2", "glass-break-3"),
  metalHit: clips("metal-hit-1", "metal-hit-2", "metal-hit-3"),
  footstepFloor: clips("step-floor-1", "step-floor-2", "step-floor-3"),
  footstepGrass: clips("step-grass-1", "step-grass-2", "step-grass-3"),
  doorClose: clips("door-close"),
  mechMotor: clips("mech-motor"),
  mechShot: clips("mech-shot"),
  shipShot: clips("ship-shot-1", "ship-shot-2"),
  interceptorShot: clips("interceptor-shot-1", "interceptor-shot-2"),
  capitalShot: clips("capital-shot"),
  shipHum: clips("ship-hum"),
  thruster: clips("thruster"),
  shieldHit: clips("shield-hit"),
  blockBreak: clips("metal-break"),
  birds: clips("birds"),
  wind: clips("wind"),
  leaves: clips("leaves"),
  fire: clips("fire"),
} as const;

export const RECORDED_SOUND_URLS = [
  ...new Set(Object.values(RECORDED_SOUNDS).flat()),
];
