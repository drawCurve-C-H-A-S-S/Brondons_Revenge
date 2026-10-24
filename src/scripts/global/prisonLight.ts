import * as THREE from "three";
import vertexShader from "../../shaders/vert/prisonLight.vert.glsl?raw";
import fragmentShader from "../../shaders/frag/prisonLight.frag.glsl?raw";

export function createPrisonLight() {
  const root = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(256, 256, 12, 256, 256, 256);
  gradient.addColorStop(0, "rgba(223, 246, 255, 0.95)");
  gradient.addColorStop(0.25, "rgba(144, 214, 255, 0.7)");
  gradient.addColorStop(0.6, "rgba(73, 167, 237, 0.3)");
  gradient.addColorStop(1, "rgba(73, 167, 237, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  const glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.012;
  const floorLight = new THREE.PointLight(0xa0d9ff, 7, 5.5, 1.4);
  floorLight.position.set(0, 0.28, 0);
  const flowMaterial = new THREE.ShaderMaterial({
    uniforms: { flowTime: { value: 0 }, strength: { value: 1 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const floorFlow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 1.15, 1.45, 48, 1, true),
    flowMaterial,
  );
  floorFlow.scale.z = 1.35;
  floorFlow.position.y = 1.45 / 2 + 0.02;
  root.add(floorGlow, floorLight, floorFlow);
  return {
    root,
    floorGlow,
    floorLight,
    floorFlow,
    flowMaterial,
    glowTexture,
    update(time: number) {
      flowMaterial.uniforms.flowTime.value = time;
      floorLight.intensity = 7 + Math.sin(time * 1.1) * 0.35;
      floorGlow.material.opacity = 0.85 + Math.sin(time * 1.1) * 0.06;
    },
  };
}
