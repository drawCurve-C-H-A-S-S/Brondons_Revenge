import * as THREE from 'three';
import { loadSubjectModel, loadToolModel } from '../../core/loader.js';
import { createScenePhysics } from '../physics/scenePhysics.js';
import { fitRoomProp, disposeRoom } from './shipRoom.js';
import { normalizeFinaleActor, SUDOERS_5 } from './finaleActors.js';

export function createFacilityOffice(scene: THREE.Scene, physics: ReturnType<typeof createScenePhysics>,
  loadChair = loadToolModel, loadStudent = loadSubjectModel) {
  const root = new THREE.Group(); root.name = 'FacilityGlassOffice'; scene.add(root);
  const floor = 4.2, front = 4, tableZ = -5;
  const peekPoint = new THREE.Vector3(11, floor + 1.55, front + 1.1);
  const tablePoint = new THREE.Vector3(0, floor + 1.1, tableZ);
  const metal = new THREE.MeshStandardMaterial({ color: 0x253e48, metalness: 0.65, roughness: 0.35 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x925d3f, roughness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xc5e8ed, transparent: true, opacity: 0.14,
    roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const bodies: ReturnType<typeof physics.addBox>[] = [];
  function box(name: string, size: [number, number, number], at: [number, number, number], material: THREE.Material, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name; mesh.position.set(...at); mesh.castShadow = mesh.receiveShadow = material !== glass; root.add(mesh);
    if (solid) bodies.push(physics.addBoxFromMesh(mesh));
    return mesh;
  }
  // The room uses the existing exterior walls; only the atrium edge is glazed.
  for (let index = 0; index < 8; index++) {
    const width = 23.5 / 8, x = -14 + width * (index + 0.5);
    box('OfficeGlassPanel', [width - 0.06, 3.5, 0.06], [x, floor + 1.85, front], glass, true);
    box('OfficeWindowMullion', [0.06, 3.7, 0.12], [-14 + width * index, floor + 1.85, front], metal);
  }
  box('OfficeGlassDoor', [2.94, 3.5, 0.06], [11, floor + 1.85, front], glass, true);
  box('OfficeGlassPanel', [1.44, 3.5, 0.06], [13.25, floor + 1.85, front], glass, true);
  for (const x of [9.5, 12.5, 14]) box('OfficeWindowMullion', [0.06, 3.7, 0.12], [x, floor + 1.85, front], metal);
  for (const y of [floor + 0.08, 7.92]) box('OfficeWindowRail', [28, 0.12, 0.12], [0, y, front], metal);
  box('OfficeDoorHandle', [0.07, 0.5, 0.1], [9.8, floor + 1.1, front + 0.09], metal);
  box('OfficeMeetingTable', [5.6, 0.16, 3.2], [0, floor + 0.84, tableZ], wood, true);
  for (const x of [-2.1, 2.1]) box('OfficeTableLeg', [0.22, 0.76, 2.3], [x, floor + 0.38, tableZ], metal);
  const light = new THREE.PointLight(0xffe2bb, 30, 20); light.position.set(0, 7.4, tableZ); root.add(light);
  const seats = [[-3.5, tableZ], [-1.8, tableZ - 2.4], [1.8, tableZ - 2.4], [3.5, tableZ], [0, tableZ + 2.5]] as const;
  const students: Array<{ root: THREE.Group; mixer: THREE.AnimationMixer; model: THREE.Group }> = [];
  let disposed = false;
  const ready = Promise.allSettled(seats.flatMap(() => [loadStudent(), loadChair('Prop_Chair')])).then(results => {
    const assets = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const failure = results.find(result => result.status === 'rejected');
    if (disposed || failure?.status === 'rejected') {
      assets.forEach(asset => disposeRoom(asset.scene));
      if (failure?.status === 'rejected') throw new Error(`Office models failed to load: ${String(failure.reason)}`);
      return;
    }
    try {
      seats.forEach(([x, z], index) => {
        const asset = assets[index * 2], chair = assets[index * 2 + 1].scene;
        const yaw = Math.atan2(-x, tableZ - z);
        fitRoomProp(chair, 1.12, 0.8, 0.9, yaw + Math.PI);
        chair.position.add(new THREE.Vector3(x, floor, z)); root.add(chair);
        const actor = new THREE.Group(); actor.name = SUDOERS_5[index].name;
        actor.position.set(x, floor, z); actor.rotation.y = yaw; root.add(actor);
        const model = normalizeFinaleActor(asset.scene, 1.83); actor.add(model);
        const clip = THREE.AnimationClip.findByName(asset.animations, index % 2 ? 'Sitting_Idle_Loop' : 'Sitting_Talking_Loop');
        if (!clip) throw new Error(`Subject is missing a seated office animation for ${actor.name}`);
        const mixer = new THREE.AnimationMixer(asset.scene); mixer.clipAction(clip).play(); mixer.update(index * 0.2);
        root.updateMatrixWorld(true);
        const pelvis = asset.scene.getObjectByName('pelvis');
        if (!pelvis) throw new Error('Office student is missing its pelvis bone');
        const ray = new THREE.Raycaster(new THREE.Vector3(x, floor + 1.5, z), new THREE.Vector3(0, -1, 0));
        const seat = ray.intersectObject(chair, true)[0];
        if (!seat) throw new Error('Office chair has no seated contact surface');
        model.position.y += seat.point.y + 0.09 - pelvis.getWorldPosition(new THREE.Vector3()).y;
        students.push({ root: actor, mixer, model: asset.scene });
      });
    } catch (error) {
      assets.filter(asset => !asset.scene.parent).forEach(asset => disposeRoom(asset.scene));
      throw error;
    }
  });
  return {
    root, ready, peekPoint, tablePoint,
    canPeek(position: { x: number; y: number; z: number }) {
      return Math.abs(position.y - (floor + 0.3)) < 0.65 && position.z > front
        && Math.hypot(position.x - peekPoint.x, position.z - peekPoint.z) < 2.3;
    },
    update(dt: number, noticed: boolean) {
      for (const student of students) {
        student.mixer.update(dt);
        if (noticed) {
          const yaw = Math.atan2(peekPoint.x - student.root.position.x, peekPoint.z - student.root.position.z);
          const turn = Math.atan2(Math.sin(yaw - student.root.rotation.y), Math.cos(yaw - student.root.rotation.y));
          student.root.rotation.y += turn * (1 - Math.exp(-dt * 3));
        }
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const student of students) { student.mixer.stopAllAction(); student.mixer.uncacheRoot(student.model); }
      root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      bodies.forEach(body => { if (body.world === physics.world) physics.world.removeBody(body); });
      root.removeFromParent(); disposeRoom(root);
    },
  };
}
