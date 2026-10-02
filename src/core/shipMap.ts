import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SHIP_ROOMS, SHIP_ROOM_BY_ID, SHIP_DECKS, SHIP_CONNECTIONS, SHIP_VENT_PATHS, SHIP_VERTICAL_LINKS,
  shipPlayerPoint, type ShipDeck, type ShipRoom } from '../helpers/scene/shipLayout.js';

type DeckFilter = ShipDeck | 'all';

export function createShipMap(renderer: THREE.WebGLRenderer, root: HTMLElement) {
  root.innerHTML = `<div class="ship-map-toolbar">
    <div class="ship-map-decks" role="group" aria-label="Deck visibility"></div>
    <div class="ship-map-tools"><button type="button" data-map-tool="out" title="Zoom out" aria-label="Zoom out">-</button>
      <button type="button" data-map-tool="in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" data-map-tool="fit" title="Fit ship to view">Fit</button>
      <button type="button" data-map-tool="current" title="Select current room">Locate</button></div>
  </div>
  <div class="ship-map-canvas" tabindex="0" aria-label="Three-floor ship map">
    <div class="ship-map-labels"></div><span class="ship-map-compass" aria-hidden="true">N</span>
  </div>
  <div class="ship-map-detail" aria-live="polite">
    <label class="ship-map-room-picker">Room<select aria-label="Select a ship room"></select></label>
    <div class="ship-map-room-info"><strong></strong><span></span></div>
    <div class="ship-map-connections" role="group" aria-label="Connected rooms"></div>
  </div>`;
  const view = root.querySelector<HTMLElement>('.ship-map-canvas')!;
  const labelLayer = root.querySelector<HTMLElement>('.ship-map-labels')!;
  const picker = root.querySelector<HTMLSelectElement>('select')!;
  const roomTitle = root.querySelector<HTMLElement>('.ship-map-room-info strong')!;
  const roomDetail = root.querySelector<HTMLElement>('.ship-map-room-info span')!;
  const connections = root.querySelector<HTMLElement>('.ship-map-connections')!;
  const decks = root.querySelector<HTMLElement>('.ship-map-decks')!;
  for (const deck of ['all', 'upper', 'main', 'lower'] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.deck = deck;
    if (deck !== 'all') {
      const swatch = document.createElement('span'); swatch.className = 'ship-map-swatch'; swatch.style.backgroundColor = SHIP_DECKS[deck].color;
      button.append(swatch);
    }
    button.append(document.createTextNode(deck === 'all' ? 'All decks' : `${SHIP_DECKS[deck].level} ${SHIP_DECKS[deck].name}`)); decks.append(button);
  }
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-80, 80, 80, -80, 0.1, 1500);
  const controls = new OrbitControls(camera, view);
  controls.enableRotate = false; controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.minZoom = 0.45; controls.maxZoom = 5;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.PAN; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.enabled = false;
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);
  const groups = new Map<number, THREE.Group>(), materials = new Map<number, THREE.ShaderMaterial>();
  const labels = new Map<number, HTMLButtonElement>(), bounds = new Map<number, THREE.Box3>();
  const outlineMaterials: THREE.LineBasicMaterial[] = [];
  const links: { object: THREE.Object3D; id: number }[] = [];
  const pickables: THREE.Mesh[] = [];
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), projected = new THREE.Vector3();
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clearColor = new THREE.Color(), size = new THREE.Vector2();
  let visible = false, filter: DeckFilter = 'all', current = 0, playerPosition: THREE.Vector3 | null = null;
  let lastRender = -Infinity, needsFit = true, dragging = false;
  const pointerStart = new THREE.Vector2();

  function materialFor(room: ShipRoom) {
    return new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(SHIP_DECKS[room.deck].color) }, uFloor: { value: SHIP_DECKS[room.deck].height },
        uSelected: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 mapWorld; varying vec3 mapNormal;
        void main() { mapWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          mapNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * vec4(mapWorld, 1.0); }`,
      fragmentShader: `uniform vec3 uTint; uniform float uFloor; uniform float uSelected; uniform float uTime;
        varying vec3 mapWorld; varying vec3 mapNormal;
        void main() {
          float relief = clamp(sqrt(max(0.0, mapWorld.y - uFloor) * 0.5), 0.0, 1.0);
          vec3 ink = mix(vec3(0.035, 0.065, 0.08), uTint, 0.23 + relief * 0.56 + uSelected * 0.22);
          vec2 grid = abs(fract(mapWorld.xz * 0.2 - 0.5) - 0.5);
          float line = 1.0 - smoothstep(0.012, 0.045, min(grid.x, grid.y));
          ink += uTint * line * 0.075;
          ink *= 0.72 + abs(normalize(mapNormal).y) * 0.28;
          ink += uTint * (0.5 + 0.5 * sin(mapWorld.z * 0.4 - uTime * 1.4)) * 0.018;
          gl_FragColor = vec4(ink, 1.0);
          #include <colorspace_fragment>
        }`,
      toneMapped: false,
    });
  }
  function block(group: THREE.Group, material: THREE.Material, dimensions: [number, number, number], position: [number, number, number], outline?: THREE.LineBasicMaterial) {
    const mesh = new THREE.Mesh(boxGeometry, material); mesh.scale.set(...dimensions); mesh.position.set(...position);
    mesh.userData.roomId = group.userData.roomId; group.add(mesh); pickables.push(mesh);
    if (outline) { const lines = new THREE.LineSegments(edgeGeometry, outline); mesh.add(lines); }
    return mesh;
  }
  function addWalls(group: THREE.Group, room: ShipRoom, material: THREE.Material, outline: THREE.LineBasicMaterial) {
    for (const side of [-1, 1]) for (const horizontal of [false, true]) {
      const length = horizontal ? room.width : room.depth, fixed = side * (horizontal ? room.depth : room.width) * 0.5;
      const doors = Object.values(room.portals).filter(portal => Math.abs((horizontal ? portal.z : portal.x) - fixed) < 0.01)
        .map(portal => horizontal ? portal.x : portal.z).sort((first, second) => first - second);
      let start = -length * 0.5;
      for (const end of [...doors.map(center => center - 1.5), length * 0.5]) {
        if (end > start) block(group, material, horizontal ? [end - start, 1.35, 0.25] : [0.25, 1.35, end - start],
          horizontal ? [(start + end) * 0.5, 0.72, fixed] : [fixed, 0.72, (start + end) * 0.5], outline);
        start = end + 3;
      }
    }
  }
  for (const room of SHIP_ROOMS) {
    const group = new THREE.Group(); group.userData.roomId = room.id; scene.add(group); groups.set(room.id, group);
    const material = materialFor(room); materials.set(room.id, material);
    const outline = new THREE.LineBasicMaterial({ color: SHIP_DECKS[room.deck].color, transparent: true, opacity: 0.65, toneMapped: false });
    outlineMaterials.push(outline);
    if (room.id === 8) {
      for (const path of SHIP_VENT_PATHS) for (let index = 1; index < path.length; index++) {
        const from = path[index - 1], to = path[index], midpoint = from.clone().add(to).multiplyScalar(0.5);
        const mesh = block(group, material, [2.2, 0.45, from.distanceTo(to) + 1.8], [midpoint.x, midpoint.y, midpoint.z], outline);
        mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      }
    } else {
      group.position.copy(room.position); group.rotation.y = room.yaw;
      block(group, material, [room.width, 0.22, room.depth], [0, -0.11, 0], outline);
      addWalls(group, room, material, outline);
      if (room.id === 2) for (const side of [-1, 1]) for (const position of [-10, -5, 0, 5, 10])
        block(group, material, [2, 0.75, 3], [side * 6.5, 0.4, position]);
      if (room.id === 4) for (const side of [-1, 1]) for (const position of [-3, 0, 3])
        block(group, material, [1.4, 0.8, 1.7], [side * 3.5, 0.4, position]);
      if ([5, 10, 11].includes(room.id)) for (const side of [-1, 1]) for (const position of [-2, 2])
        block(group, material, [1.5, 1.1, 1.5], [side * 2.5, 0.55, position]);
      if (room.id === 7) for (const position of [-2, 2]) block(group, material, [5, 0.75, 1.5], [-1, 0.38, position]);
      if (room.id === 9) for (const side of [-1, 1]) block(group, material, [2.8, 0.4, 21], [side * 7.8, 0.22, 0]);
      if (room.id === 13) for (const side of [-1, 1]) for (const position of [-15, 15])
        block(group, material, [3, 2, 3], [side * 13, 1, position]);
      if (room.id === 14) block(group, material, [7, 0.7, 12], [0, 0.36, 21]);
    }
    const label = document.createElement('button'); label.type = 'button'; label.className = 'ship-map-room-label';
    label.dataset.room = String(room.id); label.textContent = String(room.id).padStart(2, '0');
    label.title = room.name; label.setAttribute('aria-label', `${room.id}: ${room.name}, ${SHIP_DECKS[room.deck].name}`);
    label.style.setProperty('--room-color', SHIP_DECKS[room.deck].color); labelLayer.append(label); labels.set(room.id, label);
    const option = document.createElement('option'); option.value = String(room.id); option.textContent = `${String(room.id).padStart(2, '0')} / ${room.name}`; picker.append(option);
  }
  scene.updateMatrixWorld(true);
  groups.forEach((group, id) => bounds.set(id, new THREE.Box3().setFromObject(group)));
  const shaftMaterial = new THREE.LineDashedMaterial({ color: 0xd9e8df, dashSize: 1, gapSize: 0.7, transparent: true, opacity: 0.6, toneMapped: false });
  const shaftGeometries: THREE.BufferGeometry[] = [];
  for (const link of SHIP_VERTICAL_LINKS) {
    const geometry = new THREE.BufferGeometry().setFromPoints([link.position, link.position.clone().setY(link.upper)]); shaftGeometries.push(geometry);
    const line = new THREE.Line(geometry, shaftMaterial); line.computeLineDistances(); scene.add(line); links.push({ object: line, id: link.id });
  }
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false });
  const markerGeometry = new THREE.ConeGeometry(0.65, 1.7, 3); markerGeometry.rotateX(-Math.PI / 2);
  const marker = new THREE.Mesh(markerGeometry, markerMaterial); marker.renderOrder = 100; marker.visible = false; scene.add(marker);

  function fit() {
    const rect = view.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
    const box = new THREE.Box3();
    SHIP_ROOMS.filter(room => filter === 'all' || room.deck === filter).forEach(room => box.union(bounds.get(room.id)!));
    const center = box.getCenter(new THREE.Vector3()); controls.target.copy(center);
    camera.up.set(0, filter === 'all' ? 1 : 0, filter === 'all' ? 0 : -1);
    camera.position.copy(center).add(filter === 'all' ? new THREE.Vector3(65, 135, 105) : new THREE.Vector3(0, 180, 0));
    camera.lookAt(center); camera.updateMatrixWorld(true);
    const projectedBounds = new THREE.Box3();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
      projectedBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    const span = projectedBounds.getSize(new THREE.Vector3()), aspect = rect.width / rect.height;
    const half = Math.max(span.y, span.x / aspect) * 0.58;
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
    camera.zoom = 1; camera.updateProjectionMatrix(); controls.update(); needsFit = false;
  }
  function setFilter(deck: DeckFilter) {
    filter = deck;
    SHIP_ROOMS.forEach(room => { groups.get(room.id)!.visible = deck === 'all' || room.deck === deck; });
    links.forEach(link => { link.object.visible = deck === 'all'; });
    decks.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.deck === deck)));
    marker.visible = playerPosition !== null && (deck === 'all' || SHIP_ROOM_BY_ID.get(current)?.deck === deck);
    needsFit = true; lastRender = -Infinity;
  }
  function selectRoom(id: number) {
    const room = SHIP_ROOM_BY_ID.get(id); if (!room) return;
    if (filter !== 'all' && filter !== room.deck) setFilter(room.deck);
    materials.forEach((material, roomId) => { material.uniforms.uSelected.value = Number(roomId === id); });
    labels.forEach((label, roomId) => { label.setAttribute('aria-pressed', String(roomId === id)); label.dataset.current = String(roomId === current); });
    picker.value = String(id); roomTitle.textContent = room.name;
    roomDetail.textContent = `${String(id).padStart(2, '0')} / ${SHIP_DECKS[room.deck].name}${id === current ? ' / Current location' : ''}`;
    connections.replaceChildren();
    for (const pair of SHIP_CONNECTIONS.filter(pair => pair[0] === id || pair[1] === id)) {
      const neighbor = SHIP_ROOM_BY_ID.get(pair[0] === id ? pair[1] : pair[0])!;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.room = String(neighbor.id);
      button.textContent = `${String(neighbor.id).padStart(2, '0')} ${neighbor.name}`; button.title = `Select ${neighbor.name}`; connections.append(button);
    }
    lastRender = -Infinity;
  }
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
    if (button.dataset.deck) setFilter(button.dataset.deck as DeckFilter);
    if (button.dataset.room) selectRoom(Number(button.dataset.room));
    if (button.dataset.mapTool === 'fit') { needsFit = true; lastRender = -Infinity; }
    if (button.dataset.mapTool === 'in' || button.dataset.mapTool === 'out') {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (button.dataset.mapTool === 'in' ? 1.3 : 1 / 1.3), controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix();
    }
    if (button.dataset.mapTool === 'current' && current) { selectRoom(current); needsFit = true; }
  });
  picker.addEventListener('change', () => selectRoom(Number(picker.value)));
  view.addEventListener('pointerdown', event => { pointerStart.set(event.clientX, event.clientY); dragging = false; });
  view.addEventListener('pointermove', event => { if (event.buttons && pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) dragging = true; });
  view.addEventListener('pointerup', event => {
    if (dragging || (event.target as HTMLElement).closest('button')) return;
    const rect = view.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false).find(hit => groups.get(hit.object.userData.roomId)?.visible);
    if (hit) selectRoom(hit.object.userData.roomId);
  });
  view.addEventListener('keydown', event => {
    if (event.code === 'Equal' || event.code === 'Minus') {
      event.preventDefault(); camera.zoom = THREE.MathUtils.clamp(camera.zoom * (event.code === 'Equal' ? 1.15 : 1 / 1.15), controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix();
    }
  });
  const observer = new ResizeObserver(() => { if (visible) needsFit = true; }); observer.observe(view);
  setFilter('all'); selectRoom(3);
  return {
    get visible() { return visible; },
    open(sceneId: string, position?: { x: number; y: number; z: number }, yaw = 0) {
      visible = true; controls.enabled = true; current = Number(sceneId.replace('scene', ''));
      playerPosition = position ? shipPlayerPoint(current, position) : null;
      if (playerPosition) { marker.position.copy(playerPosition); marker.rotation.y = yaw + SHIP_ROOM_BY_ID.get(current)!.yaw; }
      setFilter('all'); selectRoom(SHIP_ROOM_BY_ID.has(current) ? current : 3); needsFit = true;
      root.querySelector<HTMLButtonElement>('[data-map-tool="current"]')!.disabled = !playerPosition;
    },
    hide() { visible = false; controls.enabled = false; },
    render() {
      if (!visible) return;
      controls.update(); if (needsFit) fit();
      const now = performance.now(); if (now - lastRender < 1000 / 30) return; lastRender = now;
      const rect = view.getBoundingClientRect(), canvas = renderer.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      camera.updateMatrixWorld(true);
      materials.forEach(material => { material.uniforms.uTime.value = now * 0.001; });
      const spacing = Number.parseFloat(getComputedStyle(labels.get(3)!).width) + 4;
      const placed: { x: number; y: number }[] = [];
      SHIP_ROOMS.forEach(room => {
        const label = labels.get(room.id)!; projected.copy(room.position).add(new THREE.Vector3(0, 2, 0)).project(camera);
        label.hidden = !groups.get(room.id)!.visible || Math.abs(projected.x) > 0.98 || Math.abs(projected.y) > 0.98;
        if (label.hidden) return;
        const origin = { x: (projected.x + 1) * rect.width / 2, y: (1 - projected.y) * rect.height / 2 };
        const step = spacing / 2;
        let point = origin;
        placement: for (let ring = 0; ring <= 4; ring++) for (const offsetX of [0, -ring, ring]) for (const offsetY of [0, -ring, ring]) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== ring) continue;
          const candidate = { x: origin.x + offsetX * step, y: origin.y + offsetY * step };
          if (candidate.x < step || candidate.x > rect.width - step || candidate.y < step || candidate.y > rect.height - step) continue;
          if (placed.every(other => Math.abs(other.x - candidate.x) >= spacing || Math.abs(other.y - candidate.y) >= spacing)) { point = candidate; break placement; }
        }
        placed.push(point); label.style.left = `${point.x}px`; label.style.top = `${point.y}px`;
        label.style.setProperty('--leader-length', `${Math.max(0, Math.hypot(origin.x - point.x, origin.y - point.y) - step)}px`);
        label.style.setProperty('--leader-angle', `${Math.atan2(origin.y - point.y, origin.x - point.x)}rad`);
        label.style.setProperty('--leader-start', `${step}px`);
      });
      renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getClearColor(clearColor); renderer.getSize(size);
      const target = renderer.getRenderTarget(), autoClear = renderer.autoClear, oldScissor = renderer.getScissorTest(), alpha = renderer.getClearAlpha();
      try {
        renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y);
        renderer.setClearColor(0x080d12, 1); renderer.clear(); renderer.autoClear = false;
        const scaleX = size.x / canvas.width, scaleY = size.y / canvas.height;
        renderer.setViewport((rect.left - canvas.left) * scaleX, (canvas.bottom - rect.bottom) * scaleY, rect.width * scaleX, rect.height * scaleY);
        renderer.setScissor((rect.left - canvas.left) * scaleX, (canvas.bottom - rect.bottom) * scaleY, rect.width * scaleX, rect.height * scaleY);
        renderer.setScissorTest(true); renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(target); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(oldScissor);
        renderer.setClearColor(clearColor, alpha); renderer.autoClear = autoClear;
      }
    },
    dispose() {
      observer.disconnect(); controls.dispose(); boxGeometry.dispose(); edgeGeometry.dispose(); markerGeometry.dispose(); markerMaterial.dispose();
      materials.forEach(material => material.dispose()); outlineMaterials.forEach(material => material.dispose()); shaftMaterial.dispose(); shaftGeometries.forEach(geometry => geometry.dispose()); root.replaceChildren();
    },
  };
}