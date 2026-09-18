// createHammer.ts
import * as THREE from 'three';

export interface HammerOptions {
  handleLength?: number;
  handleRadius?: number;
  headWidth?: number;
  headHeight?: number;
  headDepth?: number;
  handleColor?: THREE.ColorRepresentation;
  headColor?: THREE.ColorRepresentation;
}

const DEFAULTS: Required<HammerOptions> = {
  handleLength: 0.6,
  handleRadius: 0.03,
  headWidth: 0.18,
  headHeight: 0.1,
  headDepth: 0.1,
  handleColor: 0x8b5a2b,
  headColor: 0x555555,
};

export function createHammer(options: HammerOptions = {}): THREE.Group {
  const opts = { ...DEFAULTS, ...options };

  const hammer = new THREE.Group();
  hammer.name = 'hammer';

  // Handle — origin of the group sits at the grip point (bottom of handle)
  const handleGeo = new THREE.CylinderGeometry(
    opts.handleRadius,
    opts.handleRadius * 1.15,
    opts.handleLength,
    8
  );
  const handleMat = new THREE.MeshStandardMaterial({ color: opts.handleColor });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.y = opts.handleLength / 2;
  handle.name = 'handle';
  hammer.add(handle);

  // Head
  const headGeo = new THREE.BoxGeometry(opts.headWidth, opts.headHeight, opts.headDepth);
  const headMat = new THREE.MeshStandardMaterial({
    color: opts.headColor,
    metalness: 0.6,
    roughness: 0.4,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = opts.handleLength + opts.headHeight / 2 - 0.02;
  head.name = 'head';
  hammer.add(head);

  hammer.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return hammer;
}
