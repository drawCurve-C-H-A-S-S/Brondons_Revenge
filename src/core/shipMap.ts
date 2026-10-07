import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SHIP_ROOMS, SHIP_ROOM_BY_ID, SHIP_DECKS, SHIP_CONNECTIONS, SHIP_VENT_PATHS, SHIP_VERTICAL_LINKS,
  roomPoint, shipPlayerPoint, type ShipDeck, type ShipRoom, type ShipMapBlock } from '../helpers/scene/shipLayout.js';

type DeckFilter = ShipDeck | 'all';
interface ShipMapJoin {
  from: { room: number; portal: string };
  to: { room: number; portal: string };
}
export interface ShipMapLayout {
  name: string;
  rooms: readonly ShipRoom[];
  connections: readonly (readonly [number, number])[];
  initialRoom: number;
  playerPoint: (id: number, position: { x: number; y: number; z: number }) => THREE.Vector3 | null;
  joins?: readonly ShipMapJoin[];
  ventPaths?: readonly (readonly THREE.Vector3[])[];
  verticalLinks?: readonly { id: number; position: THREE.Vector3; upper: number; label: string }[];
}

export const SHIP_MAP_LAYOUT: ShipMapLayout = {
  name: 'Ship interior', rooms: SHIP_ROOMS, connections: SHIP_CONNECTIONS, initialRoom: 3,
  playerPoint: shipPlayerPoint, ventPaths: SHIP_VENT_PATHS, verticalLinks: SHIP_VERTICAL_LINKS,
};

export function createShipMapProgress() {
  type Section = { layout: ShipMapLayout; transform: THREE.Matrix4 };
  const sections = new Map<string, Section>(), owners = new Map<number, Section>(), rooms = new Map<number, ShipRoom>();
  const up = new THREE.Vector3(0, 1, 0);
  let snapshot: ShipMapLayout | null = null;
  function horizontalBounds(source: Iterable<ShipRoom>) {
    const box = new THREE.Box3();
    for (const room of source) for (const x of [-room.width / 2, room.width / 2]) for (const z of [-room.depth / 2, room.depth / 2])
      box.expandByPoint(roomPoint(room, x, z));
    return box;
  }
  return {
    reveal(layout: ShipMapLayout) {
      if (sections.has(layout.name)) return;
      if (!layout.rooms.length) throw new Error(`Cannot chart an empty map section: ${layout.name}`);
      for (const room of layout.rooms) if (rooms.has(room.id)) throw new Error(`Duplicate charted room ${room.id} in ${layout.name}`);
      let yaw = 0, joined = false;
      const offset = new THREE.Vector3();
      const joins = [...(layout.joins ?? []), ...[...sections.values()].flatMap(section => section.layout.joins ?? [])];
      for (const join of joins) {
        const forward = rooms.has(join.from.room) && layout.rooms.some(room => room.id === join.to.room);
        const reverse = rooms.has(join.to.room) && layout.rooms.some(room => room.id === join.from.room);
        if (!forward && !reverse) continue;
        const known = forward ? join.from : join.to, arriving = forward ? join.to : join.from;
        const anchor = rooms.get(known.room)!, local = layout.rooms.find(room => room.id === arriving.room)!;
        const exit = anchor.portals[known.portal], entry = local.portals[arriving.portal];
        if (!exit || !entry) throw new Error(`Missing map portal joining ${known.room} to ${arriving.room}`);
        yaw = anchor.yaw + exit.yaw - local.yaw - entry.yaw + Math.PI;
        offset.copy(roomPoint(anchor, exit.x, exit.z)).sub(roomPoint(local, entry.x, entry.z).applyAxisAngle(up, yaw));
        joined = true; break;
      }
      // Unconnected blueprints stay separate instead of overlapping discovered rooms.
      if (!joined && rooms.size) offset.x = horizontalBounds(rooms.values()).max.x + 24 - horizontalBounds(layout.rooms).min.x;
      const transform = new THREE.Matrix4().makeRotationY(yaw).setPosition(offset);
      const section = { layout, transform };
      sections.set(layout.name, section);
      for (const room of layout.rooms) {
        rooms.set(room.id, { ...room, position: room.position.clone().applyMatrix4(transform), yaw: room.yaw + yaw });
        owners.set(room.id, section);
      }
      snapshot = null;
    },
    getLayout(): ShipMapLayout {
      if (snapshot) return snapshot;
      const charted = [...sections.values()], connections = new Map<string, readonly [number, number]>();
      const addConnection = (from: number, to: number) => {
        if (rooms.has(from) && rooms.has(to)) connections.set(`${Math.min(from, to)}:${Math.max(from, to)}`, [from, to]);
      };
      for (const section of charted) {
        section.layout.connections.forEach(([from, to]) => addConnection(from, to));
        section.layout.joins?.forEach(join => addConnection(join.from.room, join.to.room));
      }
      snapshot = {
        name: 'Ship', rooms: [...rooms.values()], connections: [...connections.values()],
        initialRoom: charted[charted.length - 1]?.layout.initialRoom ?? 0,
        playerPoint(id, position) {
          const section = owners.get(id);
          if (!section) return null;
          return section.layout.playerPoint(id, position)?.clone().applyMatrix4(section.transform) ?? null;
        },
        ventPaths: charted.flatMap(section => (section.layout.ventPaths ?? [])
          .map(path => path.map(point => point.clone().applyMatrix4(section.transform)))),
        verticalLinks: charted.flatMap(section => (section.layout.verticalLinks ?? []).map(link => ({
          ...link, position: link.position.clone().applyMatrix4(section.transform), upper: link.upper + section.transform.elements[13],
        }))),
      };
      return snapshot;
    },
    reset() { sections.clear(); owners.clear(); rooms.clear(); snapshot = null; },
  };
}

export function getMapRoomContents(room: ShipRoom): readonly ShipMapBlock[] {
  if (room.locked) return [];
  if (room.mapContents) return room.mapContents;
  const contents: ShipMapBlock[] = [];
  const add = (size: ShipMapBlock['size'], position: ShipMapBlock['position']) => contents.push({ size, position });
  if (room.id === 2) for (const side of [-1, 1]) for (const position of [-10, -5, 0, 5, 10]) add([2, 0.75, 3], [side * 6.5, 0.4, position]);
  if (room.id === 4) for (const side of [-1, 1]) for (const position of [-3, 0, 3]) add([1.4, 0.8, 1.7], [side * 3.5, 0.4, position]);
  if ([5, 10, 11].includes(room.id)) for (const side of [-1, 1]) for (const position of [-2, 2]) add([1.5, 1.1, 1.5], [side * 2.5, 0.55, position]);
  if (room.id === 7) for (const position of [-2, 2]) add([5, 0.75, 1.5], [-1, 0.38, position]);
  if (room.id === 9) for (const side of [-1, 1]) add([2.8, 0.4, 21], [side * 7.8, 0.22, 0]);
  if (room.id === 13) for (const side of [-1, 1]) for (const position of [-15, 15]) add([3, 2, 3], [side * 13, 1, position]);
  if (room.id === 14) add([7, 0.7, 12], [0, 0.36, 21]);
  return contents;
}

export function createShipMap(renderer: THREE.WebGLRenderer, root: HTMLElement, layout?: ShipMapLayout) {
  const rooms = layout?.rooms ?? SHIP_ROOMS;
  const roomById = layout ? new Map(rooms.map(room => [room.id, room])) : SHIP_ROOM_BY_ID;
  const ventPaths = layout ? layout.ventPaths ?? [] : SHIP_VENT_PATHS;
  const verticalLinks = layout ? layout.verticalLinks ?? [] : SHIP_VERTICAL_LINKS;
  const events = new AbortController();
  root.dataset.mapLayout = layout?.name ?? 'Ship';
  root.innerHTML = `<div class="ship-map-toolbar">
    <div class="ship-map-decks" role="group" aria-label="Deck visibility"></div>
    <div class="ship-map-tools"><button type="button" data-map-tool="current" title="Center on your position (F)">Locate</button>
      <button type="button" data-map-tool="fit" title="Reset the map view (Home)">Reset view</button></div>
  </div>
  <div class="ship-map-canvas" tabindex="0" aria-label="Interactive ship map" aria-describedby="ship-map-help">
    <div class="ship-map-labels"></div><span class="ship-map-compass" aria-hidden="true">N</span>
    <div class="ship-map-room-info" aria-live="polite"><strong></strong><span></span></div>
    <div class="ship-map-empty">Reach a ship section to start charting your map.</div>
    <div id="ship-map-help" class="ship-map-help"></div>
  </div>`;
  const view = root.querySelector<HTMLElement>('.ship-map-canvas')!;
  const labelLayer = root.querySelector<HTMLElement>('.ship-map-labels')!;
  const roomInfo = root.querySelector<HTMLElement>('.ship-map-room-info')!;
  const roomTitle = root.querySelector<HTMLElement>('.ship-map-room-info strong')!;
  const roomDetail = root.querySelector<HTMLElement>('.ship-map-room-info span')!;
  const compass = root.querySelector<HTMLElement>('.ship-map-compass')!;
  root.querySelector<HTMLElement>('.ship-map-empty')!.hidden = rooms.length !== 0;
  roomInfo.hidden = rooms.length === 0;
  root.querySelector<HTMLElement>('.ship-map-help')!.textContent = document.body.classList.contains('touch-device')
    ? 'Drag to rotate / Pinch to zoom / Two fingers to pan'
    : 'Drag to rotate / Scroll to zoom / Right-drag to pan';
  const decks = root.querySelector<HTMLElement>('.ship-map-decks')!;
  const availableDecks: ShipDeck[] = ['upper', 'main', 'lower'].filter((deck): deck is ShipDeck => rooms.some(room => room.deck === deck));
  decks.hidden = availableDecks.length < 2;
  for (const deck of ['all', ...availableDecks] as const) {
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
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.rotateSpeed = 0.65;
  controls.minZoom = 0.35; controls.maxZoom = 20; controls.zoomToCursor = true;
  controls.minPolarAngle = 0.03; controls.maxPolarAngle = Math.PI * 0.49;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.listenToKeyEvents(view);
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
  const pointerStarts = new Map<number, { position: THREE.Vector2; room?: number }>(), north = new THREE.Vector3();

  function materialFor(room: ShipRoom) {
    return new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(room.locked ? '#687485' : SHIP_DECKS[room.deck].color) }, uFloor: { value: room.position.y },
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
    const gap = room.portalWidth ?? 3;
    for (const side of [-1, 1]) for (const horizontal of [false, true]) {
      const length = horizontal ? room.width : room.depth, fixed = side * (horizontal ? room.depth : room.width) * 0.5;
      const doors = Object.values(room.portals).filter(portal => Math.abs((horizontal ? portal.z : portal.x) - fixed) < 0.01)
        .map(portal => horizontal ? portal.x : portal.z).sort((first, second) => first - second);
      let start = -length * 0.5;
      for (const end of [...doors.map(center => center - gap / 2), length * 0.5]) {
        if (end > start) block(group, material, horizontal ? [end - start, 1.35, 0.25] : [0.25, 1.35, end - start],
          horizontal ? [(start + end) * 0.5, 0.72, fixed] : [fixed, 0.72, (start + end) * 0.5], outline);
        start = end + gap;
      }
    }
  }
  for (const room of rooms) {
    const group = new THREE.Group(); group.userData.roomId = room.id; scene.add(group); groups.set(room.id, group);
    const material = materialFor(room); materials.set(room.id, material);
    const outline = new THREE.LineBasicMaterial({ color: SHIP_DECKS[room.deck].color, transparent: true, opacity: 0.65, toneMapped: false });
    outlineMaterials.push(outline);
    if (room.id === 8 && ventPaths.length) {
      for (const path of ventPaths) for (let index = 1; index < path.length; index++) {
        const from = path[index - 1], to = path[index], midpoint = from.clone().add(to).multiplyScalar(0.5);
        const mesh = block(group, material, [2.2, 0.45, from.distanceTo(to) + 1.8], [midpoint.x, midpoint.y, midpoint.z], outline);
        mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      }
    } else {
      group.position.copy(room.position); group.rotation.y = room.yaw;
      if (room.locked) block(group, material, [room.width, 3.2, room.depth], [0, 1.6, 0], outline);
      else {
        block(group, material, [room.width, 0.22, room.depth], [0, -0.11, 0], outline);
        addWalls(group, room, material, outline);
        for (const item of getMapRoomContents(room)) block(group, material, item.size, item.position);
      }
    }
    const label = document.createElement('button'); label.type = 'button'; label.className = 'ship-map-room-label';
    label.dataset.room = String(room.id); label.textContent = String(room.id).padStart(2, '0');
    label.dataset.locked = String(!!room.locked);
    label.title = `${room.name}${room.locked ? ' / Locked' : ''}`; label.setAttribute('aria-label', `${room.id}: ${room.name}, ${SHIP_DECKS[room.deck].name}${room.locked ? ', locked, interior unavailable' : ''}`);
    label.style.setProperty('--room-color', SHIP_DECKS[room.deck].color); labelLayer.append(label); labels.set(room.id, label);
  }
  scene.updateMatrixWorld(true);
  groups.forEach((group, id) => bounds.set(id, new THREE.Box3().setFromObject(group)));
  const shaftMaterial = new THREE.LineDashedMaterial({ color: 0xd9e8df, dashSize: 1, gapSize: 0.7, transparent: true, opacity: 0.6, toneMapped: false });
  const shaftGeometries: THREE.BufferGeometry[] = [];
  for (const link of verticalLinks) {
    const geometry = new THREE.BufferGeometry().setFromPoints([link.position, link.position.clone().setY(link.upper)]); shaftGeometries.push(geometry);
    const line = new THREE.Line(geometry, shaftMaterial); line.computeLineDistances(); scene.add(line); links.push({ object: line, id: link.id });
  }
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false });
  const markerGeometry = new THREE.ConeGeometry(0.65, 1.7, 3); markerGeometry.rotateX(-Math.PI / 2);
  const marker = new THREE.Mesh(markerGeometry, markerMaterial); marker.renderOrder = 100; marker.visible = false; scene.add(marker);

  function fit() {
    const rect = view.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
    const box = new THREE.Box3();
    rooms.filter(room => filter === 'all' || room.deck === filter).forEach(room => box.union(bounds.get(room.id)!));
    if (box.isEmpty()) { needsFit = false; return; }
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
    const center = box.getCenter(new THREE.Vector3()); controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(65, 135, 105));
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
    const changed = filter !== deck;
    filter = deck;
    rooms.forEach(room => { groups.get(room.id)!.visible = deck === 'all' || room.deck === deck; });
    links.forEach(link => { link.object.visible = deck === 'all'; });
    decks.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.deck === deck)));
    marker.visible = playerPosition !== null && (deck === 'all' || roomById.get(current)?.deck === deck);
    if (changed) needsFit = true;
    lastRender = -Infinity;
  }
  function selectRoom(id: number) {
    const room = roomById.get(id); if (!room) return;
    if (filter !== 'all' && filter !== room.deck) setFilter(room.deck);
    materials.forEach((material, roomId) => { material.uniforms.uSelected.value = Number(roomId === id); });
    labels.forEach((label, roomId) => { label.setAttribute('aria-pressed', String(roomId === id)); label.dataset.current = String(roomId === current); });
    roomTitle.textContent = room.name;
    roomDetail.textContent = `${SHIP_DECKS[room.deck].name}${id === current ? ' / You are here' : ''}${room.locked ? ' / Locked / Interior unavailable' : ''}`;
    lastRender = -Infinity;
  }
  function locateCurrent() {
    if (!playerPosition) return;
    selectRoom(current);
    if (needsFit) fit();
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(playerPosition); camera.position.copy(playerPosition).add(offset);
    controls.update(); lastRender = -Infinity;
  }
  root.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null; if (!button) return;
    const deck = button.dataset.deck;
    if (deck === 'all' || deck === 'upper' || deck === 'main' || deck === 'lower') setFilter(deck);
    if (button.dataset.room && !dragging) selectRoom(Number(button.dataset.room));
    if (button.dataset.mapTool === 'fit') { needsFit = true; lastRender = -Infinity; }
    if (button.dataset.mapTool === 'current') locateCurrent();
  }, { signal: events.signal });
  view.addEventListener('pointerdown', event => {
    if (!pointerStarts.size) dragging = false;
    const label = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-room]') : null;
    pointerStarts.set(event.pointerId, { position: new THREE.Vector2(event.clientX, event.clientY),
      room: label ? Number(label.dataset.room) : undefined });
    if (pointerStarts.size > 1) dragging = true;
  }, { signal: events.signal });
  view.addEventListener('pointermove', event => {
    const start = pointerStarts.get(event.pointerId);
    if (start && start.position.distanceToSquared(new THREE.Vector2(event.clientX, event.clientY)) > 25) dragging = true;
  }, { signal: events.signal });
  view.addEventListener('pointerup', event => {
    const start = pointerStarts.get(event.pointerId); pointerStarts.delete(event.pointerId);
    if (!start || dragging || event.button !== 0) return;
    if (start.room !== undefined) { selectRoom(start.room); return; }
    const rect = view.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false).find(hit => groups.get(hit.object.userData.roomId)?.visible);
    if (hit) selectRoom(hit.object.userData.roomId);
  }, { signal: events.signal });
  view.addEventListener('pointercancel', event => { pointerStarts.delete(event.pointerId); dragging = true; }, { signal: events.signal });
  view.addEventListener('lostpointercapture', event => { if (pointerStarts.delete(event.pointerId)) dragging = true; }, { signal: events.signal });
  view.addEventListener('keydown', event => {
    if (event.code === 'Equal' || event.code === 'Minus' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') {
      event.preventDefault(); camera.zoom = THREE.MathUtils.clamp(camera.zoom * (event.code === 'Equal' || event.code === 'NumpadAdd' ? 1.15 : 1 / 1.15), controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix();
    }
    if (event.code === 'Home') { event.preventDefault(); needsFit = true; }
    if (event.code === 'KeyF') { event.preventDefault(); locateCurrent(); }
  }, { signal: events.signal });
  const observer = new ResizeObserver(() => {
    const rect = view.getBoundingClientRect();
    if (!visible || rect.width < 1 || rect.height < 1) return;
    camera.left = -camera.top * rect.width / rect.height; camera.right = -camera.left; camera.updateProjectionMatrix();
    lastRender = -Infinity;
  }); observer.observe(view);
  setFilter('all'); selectRoom(layout?.initialRoom ?? 3);
  return {
    get visible() { return visible; },
    open(sceneId: string, position?: { x: number; y: number; z: number }, yaw = 0) {
      visible = true; controls.enabled = true; current = Number(sceneId.replace('scene', ''));
      playerPosition = position && roomById.has(current) ? (layout?.playerPoint ?? shipPlayerPoint)(current, position) : null;
      if (playerPosition) { marker.position.copy(playerPosition); marker.rotation.y = yaw + roomById.get(current)!.yaw; }
      selectRoom(roomById.has(current) ? current : layout?.initialRoom ?? 3);
      marker.visible = playerPosition !== null && (filter === 'all' || roomById.get(current)?.deck === filter);
      dragging = false; pointerStarts.clear(); lastRender = -Infinity;
      root.querySelector<HTMLButtonElement>('[data-map-tool="current"]')!.disabled = !playerPosition;
    },
    hide() { visible = false; controls.enabled = false; pointerStarts.clear(); },
    render() {
      if (!visible) return;
      controls.update(); if (needsFit) fit();
      const now = performance.now(); if (now - lastRender < 1000 / 30) return; lastRender = now;
      const rect = view.getBoundingClientRect(), canvas = renderer.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      camera.updateMatrixWorld(true);
      north.set(0, 0, -1).transformDirection(camera.matrixWorldInverse);
      compass.style.setProperty('--north-angle', `${Math.atan2(north.x, north.y)}rad`);
      materials.forEach(material => { material.uniforms.uTime.value = now * 0.001; });
      const spacing = rooms.length ? Number.parseFloat(getComputedStyle(labels.get(rooms[0].id)!).width) + 4 : 0;
      const placed: { x: number; y: number }[] = [];
      rooms.forEach(room => {
        const label = labels.get(room.id)!; projected.copy(room.position).add(new THREE.Vector3(0, 2, 0)).project(camera);
        label.hidden = !groups.get(room.id)!.visible || Math.abs(projected.x) > 0.98 || Math.abs(projected.y) > 0.98 || Math.abs(projected.z) > 1;
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
      events.abort(); observer.disconnect(); controls.dispose(); boxGeometry.dispose(); edgeGeometry.dispose(); markerGeometry.dispose(); markerMaterial.dispose();
      materials.forEach(material => material.dispose()); outlineMaterials.forEach(material => material.dispose()); shaftMaterial.dispose(); shaftGeometries.forEach(geometry => geometry.dispose()); root.replaceChildren();
    },
  };
}