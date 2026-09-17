# Brondon's Revenge

A 3D browser game built with Three.js for the COMS3006A CGV project.

## Setup

### Install dependencies

```bash
npm install
```

### Development

Run the dev server with hot-reload:

```bash
npm run dev
```

### Production build

Build the project to the `dist/` folder:

```bash
npm run build
```

### Serve the production build

Serve the built project locally (this is how markers will run it):

```bash
npx serve dist
```

Always test the production build locally before deploying. The LAMP server serves static files only -- it will not run your build tools.

## Getting Started

- **[STARTHERE.md](./STARTHERE.md)** -- how the project is structured, how to create scenes, wire up managers, and what to watch out for.
- **[MANAGERS.md](./MANAGERS.md)** -- reference for every manager in `src/helpers/` (animation, audio, physics, triggers, scene) with usage examples.

## Project Structure

```
project-root/
  package.json
  vite.config.js
  tsconfig.json
  README.md                 Setup and deployment instructions
  STARTHERE.md              How to build scenes and use managers
  MANAGERS.md               Reference for all helper managers
  src/
    index.html              Entry point
    main.ts                 Bootstrap -- creates renderer, camera, controls, runs the loop
    core/
      renderer.ts           WebGLRenderer setup
      camera.ts             PerspectiveCamera setup
      controls.ts           OrbitControls (swap for FP controls later)
      loader.ts             GLTF/GLB model and texture loader
    scenes/
      exampleScene.ts       Example scene showing the expected interface
    scripts/
      player.ts             Example player controller class
    helpers/                Reusable managers (see MANAGERS.md)
      animation/            AnimationManager, CutsceneManager, SplineEditor
      audio/                AudioManager
      physics/              Cannon-es adapter and public API
      scene/                SceneManager, SceneAssets, sceneSchema
      triggers/             TriggerManager
      scripts/              ScriptManager
    assets/
      models/               .glb / .obj files
      textures/             Texture maps
      sounds/               Audio files
      fonts/                Web fonts
    styles/
      main.css              UI styles
    utils/
      constants.ts          Config values
  dist/                     Production build output (auto-generated)
```

Important:
- All paths must be relative (no leading `/`)
- Asset filenames must match case exactly (Linux server)
- Use lowercase filenames with hyphens, no spaces

## Tech Stack

- **Three.js** -- 3D rendering
- **TypeScript** -- Type safety
- **Vite** -- Dev server and bundler
