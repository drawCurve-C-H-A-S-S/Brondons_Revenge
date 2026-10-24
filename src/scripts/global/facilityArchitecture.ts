import * as THREE from "three";

export const FACILITY = Object.freeze({
  x: 0,
  z: -71,
  radius: 24,
  entranceSpan: 6,
  entranceHeight: 4.4,
  doorWidth: 3,
  doorHeight: 3.2,
  roofY: 24.4,
  roofThickness: 0.8,
  width: 84,
  depth: 38,
  liftRadius: 8.2,
  officeFloor: 4.2,
  windowY: 6.5,
});
export const FACILITY_WINDOW_ANGLES = Object.freeze([
  -2.45, -1.5, -0.65, 0.65, 1.5, 2.45,
]);
export const FACILITY_DOOR_Z = FACILITY.z + FACILITY.radius;
export const FACILITY_CUT_ANGLE = Math.asin(
  FACILITY.liftRadius / FACILITY.radius,
);
export const FACILITY_CUT_Y = Math.cos(FACILITY_CUT_ANGLE) * FACILITY.radius;
export const FACILITY_ROOF_SEQUENCE = Object.freeze({
  cutEnd: 1.35,
  capClear: 2,
  liftStart: 2,
  liftEnd: 4.8,
  transformStart: 4.95,
});

export function sampleFacilityLift(time: number) {
  const rise = THREE.MathUtils.smootherstep(
    time,
    FACILITY_ROOF_SEQUENCE.liftStart,
    FACILITY_ROOF_SEQUENCE.liftEnd,
  );
  return {
    rise,
    y: THREE.MathUtils.lerp(FACILITY.officeFloor, FACILITY.roofY, rise),
    cut: THREE.MathUtils.clamp(time / FACILITY_ROOF_SEQUENCE.cutEnd, 0, 1),
  };
}

export function createFacilityMezzanineShape(front: number) {
  const radius = FACILITY.radius - 1.5;
  const angle = Math.asin(front / radius);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, -angle, Math.PI + angle, false);
  shape.closePath();
  return shape;
}

export function createFacilityDomeGeometry(start = 0, length = Math.PI / 2) {
  const geometry = new THREE.SphereGeometry(
    FACILITY.radius,
    96,
    48,
    0,
    Math.PI * 2,
    start,
    length,
  );
  const positions = geometry.getAttribute("position"),
    indices = geometry.getIndex()!,
    retained: number[] = [];
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [
      indices.getX(i),
      indices.getX(i + 1),
      indices.getX(i + 2),
    ];
    const x = vertices.reduce((sum, v) => sum + positions.getX(v), 0) / 3,
      y = vertices.reduce((sum, v) => sum + positions.getY(v), 0) / 3,
      z = vertices.reduce((sum, v) => sum + positions.getZ(v), 0) / 3;
    if (
      z > FACILITY.radius * 0.8 &&
      Math.abs(x) < FACILITY.doorWidth / 2 + 0.35 &&
      y < FACILITY.doorHeight
    )
      continue;
    retained.push(...vertices);
  }
  geometry.setIndex(retained);
  return geometry;
}

/** Shared by the landing film, playable jungle, and finale; no legacy facade. */
export function createFacilityArchitecture() {
  const root = new THREE.Group();
  root.name = "SudoersDomeFacility";
  root.position.set(FACILITY.x, 0, FACILITY.z);
  const armor = new THREE.MeshStandardMaterial({
    color: 0x111722,
    metalness: 0.82,
    roughness: 0.4,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x35434b,
    metalness: 0.76,
    roughness: 0.38,
  });
  const energy = new THREE.MeshStandardMaterial({
    color: 0x51152a,
    emissive: 0xff2452,
    emissiveIntensity: 1.8,
    metalness: 0.55,
    roughness: 0.3,
  });
  const dome = new THREE.Group();
  dome.name = "FacilityVillainDome";
  const shell = new THREE.Mesh(
    createFacilityDomeGeometry(
      FACILITY_CUT_ANGLE,
      Math.PI / 2 - FACILITY_CUT_ANGLE,
    ),
    armor,
  );
  shell.name = "FacilityDomePermanentShell";
  shell.castShadow = shell.receiveShadow = true;
  dome.add(shell);
  const domeCap = new THREE.Mesh(
    createFacilityDomeGeometry(0, FACILITY_CUT_ANGLE),
    armor,
  );
  domeCap.name = "FacilityDomeCutCap";
  domeCap.castShadow = domeCap.receiveShadow = true;
  const lining = new THREE.MeshStandardMaterial({
    color: 0xe0eaec,
    metalness: 0.25,
    roughness: 0.7,
    side: THREE.BackSide,
  });
  shell.add(new THREE.Mesh(shell.geometry, lining));
  domeCap.add(new THREE.Mesh(domeCap.geometry, lining));
  dome.add(domeCap);
  root.add(dome);
  const rings = new THREE.Group();
  rings.name = "FacilityDomeEnergyRings";
  for (const y of [0.18, 8, 16]) {
    const radius = Math.sqrt(FACILITY.radius ** 2 - y ** 2) + 0.04;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.055, 8, 96),
      energy,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    rings.add(ring);
  }
  root.add(rings);
  const foundation = new THREE.Mesh(
    new THREE.CylinderGeometry(FACILITY.radius, FACILITY.radius, 0.2, 96),
    armor,
  );
  foundation.name = "FacilityRoundFoundation";
  foundation.position.y = -0.02;
  foundation.receiveShadow = true;
  root.add(foundation);
  for (const angle of FACILITY_WINDOW_ANGLES) {
    const window = new THREE.Group();
    window.name = "FacilityExteriorRoundWindow";
    const height = FACILITY.windowY,
      radius = Math.sqrt(FACILITY.radius ** 2 - height ** 2);
    window.position.set(
      Math.sin(angle) * radius,
      height,
      Math.cos(angle) * radius,
    );
    const normal = window.position.clone().normalize();
    window.position.addScaledVector(normal, 0.08);
    window.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.16, 12, 40),
      trim,
    );
    const pane = new THREE.Mesh(
      new THREE.CircleGeometry(0.94, 40),
      new THREE.MeshBasicMaterial({ color: 0xa8dacf, toneMapped: false }),
    );
    pane.position.z = 0.025;
    window.add(frame, pane);
    dome.add(window);
  }
  const shape = new THREE.Shape();
  shape.moveTo(-FACILITY.width / 2, -FACILITY.depth / 2);
  shape.lineTo(FACILITY.width / 2, -FACILITY.depth / 2);
  shape.lineTo(FACILITY.width / 2, FACILITY.depth / 2);
  shape.lineTo(-FACILITY.width / 2, FACILITY.depth / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, FACILITY.liftRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const roof = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: FACILITY.roofThickness,
      bevelEnabled: false,
      curveSegments: 64,
    }),
    armor,
  );
  roof.name = "RescueSiteFacilityRoof";
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = FACILITY.roofY - FACILITY.roofThickness;
  roof.castShadow = roof.receiveShadow = true;
  root.add(roof);
  const roofCap = new THREE.Mesh(
    new THREE.CylinderGeometry(
      FACILITY.liftRadius,
      FACILITY.liftRadius,
      FACILITY.roofThickness,
      64,
    ),
    armor,
  );
  roofCap.name = "FacilityDeckCutCap";
  roofCap.position.y = FACILITY.roofY - FACILITY.roofThickness / 2;
  root.add(roofCap);
  const pillars = new THREE.Group();
  pillars.name = "FacilityFourRoofPillars";
  for (const x of [-FACILITY.width / 2 + 3, FACILITY.width / 2 - 3])
    for (const z of [-FACILITY.depth / 2 + 3, FACILITY.depth / 2 - 3]) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.9,
          1.25,
          FACILITY.roofY - FACILITY.roofThickness,
          8,
        ),
        trim,
      );
      pillar.name = "FacilityRoofSupportPillar";
      pillar.position.set(x, (FACILITY.roofY - FACILITY.roofThickness) / 2, z);
      pillar.castShadow = pillar.receiveShadow = true;
      pillars.add(pillar);
    }
  root.add(pillars);
  const entrance = new THREE.Group();
  entrance.name = "FacilityExteriorEntrance";
  entrance.position.z = FACILITY.radius + 0.12;
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.1, 1.1), trim);
    jamb.position.set(side * 3.25, 2.55, 0);
    entrance.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.65, 1.1), trim);
  lintel.position.y = 4.8;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(FACILITY.doorWidth, FACILITY.doorHeight, 0.25),
    armor,
  );
  door.name = "FacilityExteriorDoor";
  door.position.y = FACILITY.doorHeight / 2;
  entrance.add(lintel, door);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4.4, 0.3), armor);
    panel.position.set(side * 2.25, 2.2, 0);
    entrance.add(panel);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 0.3), armor);
  header.position.y = 3.8;
  entrance.add(header);
  root.add(entrance);
  return { root, dome, shell, domeCap, rings, roof, roofCap, pillars, door };
}
