import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadPlayerModel, loadToolModel } from '../core/loader.js';
import { createCrowbar } from './items/createCrowbar.js';
import { bakePosedLimb, disposeBakedLimb } from '../helpers/animation/bakePosedLimb.js';

/**
 * Everything you are likely to nudge by eye. View space: +x right, +y up, -z forward.
 * Edit live from the console via the returned `tuning`, then call `remountMelee()` for the melee values.
 */
const createTuning = () => ({
  // --- Pistol (two-handed) ---
  /** Right wrist while aiming; closer to screen centre than the one-handed rest pose. */
  pistolWrist: new THREE.Vector3(0.16, -0.2, -0.6),
  /** Left wrist relative to the centre of the right fist. */
  supportOffset: new THREE.Vector3(-0.07, -0.05, 0.05),
  /** Left forearm: yaw swings the elbow outward, pitch drops it, roll turns the palm toward the gun. */
  supportYaw: -0.35,
  supportPitch: 0.35,
  supportRoll: -1.0,
  recoilKick: 0.12,
  // --- Melee ---
  /** Direction the blade/bar leaves the fist. Raised so it reads as held, not as a spear pointing at the lens. */
  meleeForward: new THREE.Vector3(-0.12, 0.65, -1),
  /** Local +Z of the crowbar maps toward this view direction (x right, y up, -z forward). The hook curls toward local -Z,
   *  so it points the opposite way. (0.4, 0.55, 0.35) sends the hook forward, down and slightly inward, away from the lens.
   *  Presets for the hook direction: right (-1,-0.35,0), left (1,-0.35,0), forward-down (0,1,0.4), straight up (0,-1,0). */
  crowbarUp: new THREE.Vector3(0.4, 0.55, 0.35),
  crowbarSeat: 0.09,
  lightsaberUp: new THREE.Vector3(0, 1, 0),
  lightsaberAnchor: new THREE.Vector3(0, 0.12, 0),
  lightsaberSeat: 0.09,
});

export async function createFirstPersonHands(loader?: GLTFLoader) {
  const tuning = createTuning();
  const gltf = await loadPlayerModel(loader);
  const model = gltf.scene;
  const mixer = new THREE.AnimationMixer(model);
  const idle = THREE.AnimationClip.findByName(gltf.animations, 'Sword_Idle');
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.update();
  });

  const viewScene = new THREE.Scene();
  const viewCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  const handsGroup = new THREE.Group();
  viewScene.add(viewCamera);
  viewCamera.add(handsGroup);
  viewScene.add(new THREE.AmbientLight(0xffffff, 1.5));

  function createArm(side: 'l' | 'r', wristPosition: THREE.Vector3, elbowPosition: THREE.Vector3, parent: THREE.Group) {
    const hand = model.getObjectByName(`hand_${side}`);
    const elbow = model.getObjectByName(`lowerarm_${side}`);
    if (!hand || !elbow) throw new Error(`MC.glb is missing the ${side} arm`);
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const sourceDirection = elbow.getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
    const arm = bakePosedLimb(model, `lowerarm_${side}`, wrist);
    arm.position.copy(wristPosition);
    arm.quaternion.setFromUnitVectors(sourceDirection, elbowPosition.clone().sub(wristPosition).normalize());
    parent.add(arm);
    const grip = new THREE.Group();
    grip.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()));
    if (side === 'r') {
      const knuckle = model.getObjectByName('middle_01_r');
      const curledFinger = model.getObjectByName('middle_03_r');
      if (knuckle && curledFinger) grip.position.copy(knuckle.getWorldPosition(new THREE.Vector3())).add(curledFinger.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5).sub(wrist);
    }
    arm.add(grip);
    return grip;
  }

  const leftPivot = new THREE.Group();
  const leftWrist = new THREE.Vector3(-0.23, -0.31, -0.65);
  leftPivot.position.copy(leftWrist); handsGroup.add(leftPivot);
  createArm('l', new THREE.Vector3(), new THREE.Vector3(-0.13, -0.31, 0.4), leftPivot);
  const swingPivot = new THREE.Group();
  const restingWrist = new THREE.Vector3(0.25, -0.16, -0.62);
  swingPivot.position.copy(restingWrist); handsGroup.add(swingPivot);
  const rightHand = createArm('r', new THREE.Vector3(), new THREE.Vector3(0.16, -0.39, 0.40), swingPivot);
  viewScene.updateMatrixWorld(true);
  const gripQuat = rightHand.getWorldQuaternion(new THREE.Quaternion());
  const handToPivot = swingPivot.matrixWorld.clone().invert().multiply(rightHand.matrixWorld).invert();
  const seatDown = new THREE.Vector3(0, -1, 0).applyQuaternion(gripQuat.clone().invert());
  // Mount a weapon so its local `forwardAxis` leaves the fist toward `forward` (view space)
  // and its local `upAxis` rolls toward `up`, regardless of the baked hand pose.
  // `anchor` is the model-space point seated in the fist; `seat` drops it into the palm.
  function mount(obj: THREE.Object3D, forwardAxis: THREE.Vector3, upAxis: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, anchor = new THREE.Vector3(), seat = 0) {
    const y = forward.clone().normalize();
    const z = up.clone().addScaledVector(y, -up.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const localX = new THREE.Vector3().crossVectors(forwardAxis, upAxis);
    const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(localX, forwardAxis, upAxis));
    obj.quaternion.copy(gripQuat.clone().invert().multiply(target).multiply(local.invert()));
    obj.position.copy(anchor.clone().applyQuaternion(obj.quaternion).negate());
    if (seat) obj.position.addScaledVector(seatDown, seat);
  }

  // Pistol keeps its own flatter carry direction: the muzzle-FX socket below must match it.
  const carryForward = new THREE.Vector3(-0.08, 0.10, -1);
  const crowbar = createCrowbar();
  rightHand.add(crowbar);

  // Muzzle-FX socket: grip origin with -Z along the carry direction, matching the pistol controller's root frame.
  const socketUp = new THREE.Vector3(0, 1, 0).addScaledVector(carryForward, -carryForward.y).normalize();
  const socketQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(socketUp, carryForward.clone().negate()),
    socketUp,
    carryForward.clone().negate()));

  let pistol: THREE.Group | null = null;
  try {
    const pistolGltf = await loadToolModel('Gun_Revolver');
    pistol = pistolGltf.scene;
    // Gun_Revolver.glb: muzzle along -X, sight up +Y, grip hanging at -Y/+X.
    mount(pistol, new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), carryForward, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.04, -0.06, 0), 0.10);
    pistol.visible = false;
    rightHand.add(pistol);
  } catch (error) {
    console.error('[FirstPersonHands] Pistol load failed:', error);
  }

  let lightsaber: THREE.Group | null = null;
  try {
    const { createLightsaber } = await import('./items/createLightsaber.js');
    lightsaber = createLightsaber();
    lightsaber.visible = false;
    rightHand.add(lightsaber);
  } catch (error) {
    console.error('[FirstPersonHands] Lightsaber load failed:', error);
  }

  const AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);
  /** Re-applies the melee grips from `tuning`; call after editing melee values at runtime. */
  function remountMelee() {
    mount(crowbar, AXIS_Y, AXIS_Z, tuning.meleeForward, tuning.crowbarUp, new THREE.Vector3(), tuning.crowbarSeat);
    if (lightsaber) mount(lightsaber, AXIS_Y, AXIS_Z, tuning.meleeForward, tuning.lightsaberUp, tuning.lightsaberAnchor, tuning.lightsaberSeat);
  }
  remountMelee();

  mixer.stopAllAction(); mixer.uncacheRoot(model);

  let pistolEquipped = false;
  let lightsaberEquipped = false;
  let recoil = 0;
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  // Lightsaber pose copied from the third-person character's saber, in view space (see setLightsaberPose).
  const saberPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), valid: false };
  const mSaber = new THREE.Matrix4(), mMount = new THREE.Matrix4();
  const pivotPos = new THREE.Vector3(), pivotQuat = new THREE.Quaternion(), pivotScale = new THREE.Vector3();
  const UNIT = new THREE.Vector3(1, 1, 1);
  /** Position/orientation of the character's saber relative to the eye, already flipped to face -Z. */
  function setLightsaberPose(position: THREE.Vector3 | null, quaternion?: THREE.Quaternion, mainFov?: number) {
    if (!position || !quaternion) { saberPose.valid = false; return; }
    // Same re-projection as getMuzzle: keep the on-screen position when the overlay FOV differs from the main camera's.
    const k = mainFov ? Math.tan(THREE.MathUtils.degToRad(mainFov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(viewCamera.fov * 0.5)) : 1;
    saberPose.position.set(position.x * k, position.y * k, position.z);
    saberPose.quaternion.copy(quaternion);
    saberPose.valid = true;
  }
  /** Moves the right arm so the fist carries the saber along the character's attack animation, easing in and out. */
  function followSaber(t: number) {
    const weight = THREE.MathUtils.smoothstep(t, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1));
    if (!lightsaber || weight <= 0) return;
    lightsaber.updateMatrix();
    mMount.copy(lightsaber.matrix).invert();
    // wanted saber = fist * mount  =>  fist = saber * mount^-1  =>  pivot = fist * handToPivot
    mSaber.compose(saberPose.position, saberPose.quaternion, UNIT).multiply(mMount).multiply(handToPivot);
    mSaber.decompose(pivotPos, pivotQuat, pivotScale);
    swingPivot.position.lerp(pivotPos, weight);
    swingPivot.quaternion.slerp(pivotQuat, weight);
  }
  function setPistolEquipped(equipped: boolean) {
    pistolEquipped = equipped;
    if (pistol) pistol.visible = equipped;
    if (equipped) crowbar.visible = false;
  }
  function setLightsaberEquipped(equipped: boolean) {
    lightsaberEquipped = equipped;
    if (lightsaber) lightsaber.visible = equipped;
    if (equipped) crowbar.visible = false;
  }
  /** 0..1 muzzle-kick amount; the pistol controller feeds this every frame. */
  function setRecoil(amount: number) { recoil = THREE.MathUtils.clamp(amount, 0, 1); }

  /** Two-handed stance: right hand drives the gun, left fist cups it from the lower left. */
  function poseTwoHandGrip() {
    swingPivot.position.copy(tuning.pistolWrist);
    swingPivot.position.z += recoil * 0.04;
    swingPivot.rotation.set(recoil * tuning.recoilKick, 0, 0);
    // The right fist must be in its final place *before* the left hand is positioned against it.
    rightHand.getWorldPosition(leftPivot.position).add(tuning.supportOffset);
    // View-space orientation only: do not inherit the right hand's baked bone rotation, or the forearm flails.
    tmpEuler.set(tuning.supportPitch + recoil * tuning.recoilKick, tuning.supportYaw, tuning.supportRoll, 'YXZ');
    leftPivot.quaternion.setFromEuler(tmpEuler);
  }

  function update(attackProgress: number | null, move: 'crowbar' | 'jab' | 'cross' | 'hook' = 'crowbar') {
    crowbar.visible = !pistolEquipped && !lightsaberEquipped && move === 'crowbar';
    if (pistol) pistol.visible = pistolEquipped;
    if (lightsaber) lightsaber.visible = lightsaberEquipped;
    if (pistolEquipped) { poseTwoHandGrip(); return; }

    leftPivot.position.copy(leftWrist); leftPivot.quaternion.identity();
    swingPivot.position.copy(restingWrist); swingPivot.rotation.set(0, 0, 0);
    if (lightsaberEquipped && saberPose.valid && attackProgress !== null) { followSaber(attackProgress); return; }
    const t = attackProgress ?? 1;
    let windup = 0, strike = 0;
    if (t < 0.25) windup = THREE.MathUtils.smoothstep(t, 0, 0.25);
    else if (t < 0.5) { strike = THREE.MathUtils.smoothstep(t, 0.25, 0.5); windup = 1 - strike; }
    else strike = 1 - THREE.MathUtils.smoothstep(t, 0.5, 1);
    if (move !== 'crowbar') {
      const pivot = move === 'jab' ? leftPivot : swingPivot;
      const wrist = move === 'jab' ? leftWrist : restingWrist;
      const side = move === 'jab' ? -1 : 1, hook = move === 'hook';
      pivot.position.set(wrist.x - side * strike * (hook ? 0.25 : 0.1),
        wrist.y + strike * 0.08, wrist.z + windup * 0.1 - strike * (hook ? 0.25 : 0.45));
      pivot.rotation.set(-strike * 0.1, side * (windup * 0.15 - strike * (hook ? 0.65 : 0.08)), side * strike * 0.12);
      return;
    }
    swingPivot.rotation.set(0.20 * windup - 0.45 * strike, -0.10 * windup, -0.15 * windup + 0.50 * strike);
    swingPivot.position.set(restingWrist.x - 0.03 * windup - 0.12 * strike, restingWrist.y + 0.03 * windup + 0.05 * strike, restingWrist.z - 0.06 * strike);
  }

  return {
    update,
    setPistolEquipped,
    setLightsaberEquipped,
    setRecoil,
    setLightsaberPose,
    tuning,
    remountMelee,
    /** Grip-socket transform in main-camera space, so world-space muzzle FX line up with the overlay gun. */
    getMuzzle(camera: THREE.PerspectiveCamera, position: THREE.Vector3, orientation: THREE.Quaternion) {
      rightHand.getWorldPosition(position);
      const k = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(viewCamera.fov * 0.5));
      position.x *= k; position.y *= k;
      orientation.copy(socketQuat);
    },
    render(renderer: THREE.WebGLRenderer) {
      const oldAspect = viewCamera.aspect;
      viewCamera.aspect = renderer.domElement.width / renderer.domElement.height;
      if (oldAspect !== viewCamera.aspect) viewCamera.updateProjectionMatrix();
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      try { renderer.clearDepth(); renderer.render(viewScene, viewCamera); } finally { renderer.autoClear = oldAutoClear; }
    },
    dispose() {
      disposeBakedLimb(handsGroup);
    },
  };
}
