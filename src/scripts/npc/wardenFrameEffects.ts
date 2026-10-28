import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Composites the actual completed game frame; never changes the shared camera. */
export function createWardenFrameEffects(reducedMotion: boolean) {
  let frame: THREE.FramebufferTexture | null = null;
  let captured = false;
  const size = new THREE.Vector2();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      image: { value: null as THREE.Texture | null }, slide: { value: 0 }, fade: { value: 1 },
      cutNormal: { value: new THREE.Vector2(1, 0) }, cutOffset: { value: 0.5 },
      age: { value: 0 }, motion: { value: reducedMotion ? 0 : 1 },
    },
    vertexShader: "varying vec2 uvFrame; void main(){ uvFrame=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
    fragmentShader: `uniform sampler2D image; uniform float slide; uniform float fade;
      uniform vec2 cutNormal; uniform float cutOffset; uniform float age; uniform float motion; varying vec2 uvFrame;
      void main(){ float side=dot(uvFrame,cutNormal)<cutOffset?-1.0:1.0;
        vec2 source=uvFrame-cutNormal*side*slide;
        if(source.x<0.0||source.x>1.0||source.y<0.0||source.y>1.0||(dot(source,cutNormal)-cutOffset)*side<0.0) discard;
        float life=exp(-age*5.0);
        vec2 fringe=cutNormal*life*0.004*motion;
        vec3 frame=vec3(texture2D(image,source+fringe).r,texture2D(image,source).g,texture2D(image,source-fringe).b);
        float seam=abs(dot(source,cutNormal)-cutOffset);
        float edge=exp(-seam*420.0)*life;
        vec2 tangent=vec2(-cutNormal.y,cutNormal.x);
        float along=dot(source,tangent);
        float sparks=pow(max(0.0,sin(along*270.0+age*38.0)),24.0);
        sparks*=exp(-seam*(100.0+age*160.0))*life*motion;
        gl_FragColor=vec4(frame+vec3(0.25,0.8,1.0)*edge*1.8+vec3(1.0,0.8,0.35)*sparks*2.0,fade); }`,
  });
  const quad = new FullScreenQuad(material);
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  function reset() { captured = false; }
  return {
    reset,
    render(renderer: THREE.WebGLRenderer, sliceAge: number,
      cutLine: { normal: THREE.Vector2; offset: number }) {
      if (sliceAge < 0 || sliceAge >= 1.1) return;
      const target = renderer.getRenderTarget();
      renderer.getViewport(viewport);
      renderer.getScissor(scissor);
      const scissorTest = renderer.getScissorTest(), autoClear = renderer.autoClear;
      renderer.getDrawingBufferSize(size);
      try {
        renderer.setRenderTarget(null);
        renderer.setScissorTest(false);
        renderer.autoClear = false;
        if (sliceAge >= 0 && sliceAge < 1.1) {
          if (!frame || frame.image.width !== size.x || frame.image.height !== size.y) {
            frame?.dispose();
            frame = new THREE.FramebufferTexture(size.x, size.y);
            material.uniforms.image.value = frame;
            captured = false;
          }
          if (!captured) {
            renderer.copyFramebufferToTexture(frame);
            material.uniforms.cutNormal.value.copy(cutLine.normal);
            material.uniforms.cutOffset.value = cutLine.offset;
            captured = true;
          }
          const progress = THREE.MathUtils.smootherstep(sliceAge, 0.25, 1.1);
          material.uniforms.slide.value = reducedMotion ? 0 : progress * 1.5;
          material.uniforms.fade.value = reducedMotion ? 1 - progress : 1;
          material.uniforms.age.value = sliceAge;
          quad.render(renderer);
        }
      } finally {
        renderer.setRenderTarget(target);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
        renderer.autoClear = autoClear;
      }
    },
    dispose() {
      frame?.dispose(); material.dispose(); quad.dispose();
    },
  };
}
