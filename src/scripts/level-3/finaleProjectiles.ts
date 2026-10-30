import * as THREE from "three";
import type { DuelProjectileKind, MechSide } from "../npc/mechDuel.js";
import { createBeamMaterial, FRAME_COLORS } from "./finaleMaterials.js";

/** Shared by Story cinematics, Story combat and local versus. */
export function createFinaleProjectiles(scene: THREE.Scene) {
  const missileGeometry = new THREE.CapsuleGeometry(0.14, 2.4, 4, 8);
  const noseGeometry = new THREE.ConeGeometry(0.2, 0.42, 8);
  const tracerGeometry = new THREE.CylinderGeometry(0.32, 0.025, 5.4, 12);
  const missileMaterials = {
    hero: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xdcfaff).multiplyScalar(6), toneMapped: false,
    }),
    enemy: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffe6ec).multiplyScalar(6), toneMapped: false,
    }),
  };
  const tracerMaterials = {
    hero: createBeamMaterial(FRAME_COLORS.hero),
    enemy: createBeamMaterial(FRAME_COLORS.enemy),
  };
  const flameMaterials = {
    hero: new THREE.MeshBasicMaterial({ color: 0x87eaff, toneMapped: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xcd7480, toneMapped: false }),
  };
  const shape = new THREE.Shape();
  shape.moveTo(-6.2, -1.6);
  shape.quadraticCurveTo(0, 5.8, 6.2, -1.6);
  shape.quadraticCurveTo(0, 2.6, -6.2, -1.6);
  const waveGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.08, bevelThickness: 0.08, steps: 1,
  });
  waveGeometry.translate(0, 0, -0.09);
  const waveGlowGeometry = new THREE.ShapeGeometry(shape, 32);
  const verdictGeometry = new THREE.CylinderGeometry(0.24, 0.24, 10.5, 20);
  const waveMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xc6f3ff).multiplyScalar(2.4), toneMapped: false,
  });
  const waveGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(FRAME_COLORS.hero).multiplyScalar(3),
    transparent: true, opacity: 0.38, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const waveWake = waveGlow.clone();
  waveWake.opacity = 0.16;
  const enemyWave = createBeamMaterial(FRAME_COLORS.enemy);
  enemyWave.uniforms.uPower.value = 0.85;
  const enemyGlow = enemyWave.clone();
  enemyGlow.uniforms.uPower.value = 0.28;
  const enemyWake = enemyWave.clone();
  enemyWake.uniforms.uPower.value = 0.1;
  const verdictMaterials = {
    hero: new THREE.MeshBasicMaterial({
      color: new THREE.Color(FRAME_COLORS.hero).multiplyScalar(2.2), toneMapped: false,
    }),
    enemy: new THREE.MeshBasicMaterial({
      color: new THREE.Color(FRAME_COLORS.enemy).multiplyScalar(1.1), toneMapped: false,
    }),
  };
  const verdictGlows = {
    hero: createBeamMaterial(FRAME_COLORS.hero),
    enemy: createBeamMaterial(FRAME_COLORS.enemy),
  };
  verdictGlows.enemy.uniforms.uPower.value = 0.3;
  const pool = Array.from({ length: 32 }, () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(missileGeometry, missileMaterials.hero);
    const nose = new THREE.Mesh(noseGeometry, missileMaterials.hero);
    const flame = new THREE.Mesh(noseGeometry, flameMaterials.hero);
    const tracer = new THREE.Mesh(tracerGeometry, tracerMaterials.hero);
    tracer.name = "RifleIonTracer";
    tracer.position.y = -2.4;
    nose.position.y = 1.3;
    flame.position.y = -1.3;
    flame.rotation.z = Math.PI;
    const wave = new THREE.Group();
    wave.name = "FlyingBladeWave";
    const edge = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(waveGeometry, waveMaterial);
    const glow = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(waveGlowGeometry, waveGlow);
    glow.scale.set(1.14, 1.2, 1);
    const wake = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(waveGlowGeometry, waveWake);
    wake.position.y = -1.6;
    wake.scale.set(0.86, 0.9, 1);
    const tail = wake.clone();
    tail.position.y = -3.2;
    tail.scale.set(0.64, 0.72, 1);
    edge.rotation.x = glow.rotation.x = -0.12;
    wave.add(edge, glow, wake, tail);
    const beam = new THREE.Mesh(verdictGeometry, verdictMaterials.enemy);
    beam.name = "SwordTipBeam";
    const beamGlow = new THREE.Mesh(verdictGeometry, verdictGlows.enemy);
    beamGlow.scale.set(2.5, 1, 2.5);
    beam.add(beamGlow);
    wave.visible = beam.visible = root.visible = false;
    root.add(body, nose, flame, tracer, wave, beam);
    scene.add(root);
    return { root, body, nose, flame, tracer, wave, edge, glow, wake, tail, beam, beamGlow };
  });
  return {
    pool,
    style(visual: typeof pool[number], owner: MechSide, kind: DuelProjectileKind) {
      visual.body.material = visual.nose.material = missileMaterials[owner];
      visual.flame.material = flameMaterials[owner];
      visual.tracer.material = tracerMaterials[owner];
      visual.beam.material = verdictMaterials[owner];
      visual.beamGlow.material = verdictGlows[owner];
      visual.edge.material = owner === "enemy" ? enemyWave : waveMaterial;
      visual.glow.material = owner === "enemy" ? enemyGlow : waveGlow;
      visual.wake.material = visual.tail.material = owner === "enemy" ? enemyWake : waveWake;
      visual.body.visible = visual.nose.visible = visual.flame.visible = visual.tracer.visible = kind === "round";
      visual.wave.visible = kind === "bladeWave";
      visual.beam.visible = kind === "verdictBeam";
    },
    update(time: number) {
      for (const material of [
        enemyWave, enemyGlow, enemyWake,
        ...Object.values(verdictGlows), ...Object.values(tracerMaterials),
      ]) material.uniforms.uTime.value = time;
    },
    dispose() {
      pool.forEach((visual) => visual.root.removeFromParent());
      for (const geometry of [missileGeometry, noseGeometry, tracerGeometry, waveGeometry, waveGlowGeometry, verdictGeometry])
        geometry.dispose();
      for (const material of [
        waveMaterial, waveGlow, waveWake, enemyWave, enemyGlow, enemyWake,
        ...Object.values(missileMaterials), ...Object.values(tracerMaterials),
        ...Object.values(flameMaterials), ...Object.values(verdictMaterials), ...Object.values(verdictGlows),
      ]) material.dispose();
    },
  };
}
