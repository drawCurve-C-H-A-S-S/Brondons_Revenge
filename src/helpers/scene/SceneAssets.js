const SCRIPT_TEMPLATE = (className) => `export class ${className} {
  constructor({ mesh, physics, camera, audioManager }) {
    this.mesh = mesh;
    this.physics = physics;
    this.camera = camera;
    this.audio = audioManager;
  }

  update(input, deltaTime) {
    // Add game-specific behavior here.
  }
}
`;

function slugify(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

/**
 * In-memory registry for the scripts, shaders, and imported audio a single
 * scene references. Replaces the multi-file "project" concept: everything
 * here exists only for the current session and is bundled by the exporter.
 */
export class SceneAssets {
  constructor({ onChange } = {}) {
    this.files = new Map();
    this.onChange = onChange;
  }

  get(path) {
    return this.files.get(path);
  }

  listScripts() {
    return [...this.files.values()]
      .filter((file) => file.type === 'javascript' && file.path.startsWith('scripts/'))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  createScript(name = 'new-script') {
    const path = `scripts/${slugify(name)}.js`;
    if (this.files.has(path)) throw new Error(`Script already exists: ${path}`);
    const className = name.replace(/[^a-zA-Z0-9]/g, '') || 'GameScript';
    const file = { path, type: 'javascript', content: SCRIPT_TEMPLATE(className), exportName: className };
    this.files.set(path, file);
    this.onChange?.();
    return file;
  }

  createShaderFiles(name = 'custom-material') {
    const base = slugify(name);
    const vertexPath = `shaders/${base}.vert`;
    const fragmentPath = `shaders/${base}.frag`;
    if (!this.files.has(vertexPath)) this.files.set(vertexPath, { path: vertexPath, type: 'shader', content: '' });
    if (!this.files.has(fragmentPath)) this.files.set(fragmentPath, { path: fragmentPath, type: 'shader', content: '' });
    this.onChange?.();
    return { vertexPath, fragmentPath };
  }

  listShaders() {
    const bases = new Map();
    for (const file of this.files.values()) {
      if (file.type !== 'shader' || !file.path.endsWith('.vert')) continue;
      const base = file.path.slice('shaders/'.length, -'.vert'.length);
      bases.set(base, { name: base, vertexPath: file.path, fragmentPath: `shaders/${base}.frag` });
    }
    return [...bases.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  createUniqueShaderFiles(name = 'custom-material') {
    const base = slugify(name);
    const vertexPath = `shaders/${base}.vert`;
    const fragmentPath = `shaders/${base}.frag`;
    if (this.files.has(vertexPath) || this.files.has(fragmentPath)) throw new Error(`Shader already exists: ${base}`);
    this.files.set(vertexPath, { path: vertexPath, type: 'shader', content: '' });
    this.files.set(fragmentPath, { path: fragmentPath, type: 'shader', content: '' });
    this.onChange?.();
    return { vertexPath, fragmentPath };
  }

  renameShaderFiles(vertexPath, fragmentPath, newName) {
    const base = slugify(newName);
    const newVertexPath = `shaders/${base}.vert`;
    const newFragmentPath = `shaders/${base}.frag`;
    if (newVertexPath !== vertexPath && (this.files.has(newVertexPath) || this.files.has(newFragmentPath))) {
      throw new Error(`Shader already exists: ${base}`);
    }
    const vertexFile = this.files.get(vertexPath);
    const fragmentFile = this.files.get(fragmentPath);
    if (vertexFile) {
      this.files.delete(vertexPath);
      vertexFile.path = newVertexPath;
      this.files.set(newVertexPath, vertexFile);
    }
    if (fragmentFile) {
      this.files.delete(fragmentPath);
      fragmentFile.path = newFragmentPath;
      this.files.set(newFragmentPath, fragmentFile);
    }
    this.onChange?.();
    return { vertexPath: newVertexPath, fragmentPath: newFragmentPath };
  }

  listAudio(folder) {
    return [...this.files.values()].filter((file) => file.type === 'audio' && file.path.startsWith(`audio/${folder}/`));
  }

  addImportedAudio(folder, fileList) {
    const added = [];
    for (const source of fileList) {
      const path = `audio/${folder}/${source.name}`;
      const file = { path, type: 'audio', content: source, mimeType: source.type };
      this.files.set(path, file);
      added.push(file);
    }
    this.onChange?.();
    return added;
  }
}
