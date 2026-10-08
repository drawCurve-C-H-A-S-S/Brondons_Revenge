import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createFinaleRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, mobile: boolean) {
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04); room.dispose(); pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.7;
  const size = renderer.getSize(new THREE.Vector2()), composer = new EffectComposer(renderer);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(size, mobile ? 0.45 : 0.68, 0.48, 1.35);
  const output = new OutputPass(); composer.addPass(render); composer.addPass(bloom); composer.addPass(output);
  let width = size.x, height = size.y, disposed = false;
  return {
    render() {
      if (disposed) return;
      renderer.getSize(size);
      if (size.x !== width || size.y !== height) {
        width = size.x; height = size.y; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(width, height);
      }
      composer.render(0);
    },
    prepare: () => renderer.compileAsync(scene, camera),
    dispose() {
      if (disposed) return; disposed = true;
      scene.environment = null; environment.dispose(); render.dispose(); bloom.dispose(); output.dispose(); composer.dispose();
    },
  };
}
