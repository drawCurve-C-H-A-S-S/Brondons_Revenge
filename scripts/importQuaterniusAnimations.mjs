import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";

const sourceDirectory = process.argv[2];
if (!sourceDirectory)
  throw new Error(
    "Pass the directory containing UAL1_Standard.glb and UAL2_Standard.glb",
  );
const project = fileURLToPath(new URL("../", import.meta.url));
const selected = /^(Sword_|Punch_|Melee_Hook|Slide_)/;
const rounded = (value) => Math.round(value * 1e6) / 1e6;

async function readRig(filename) {
  const bytes = await readFile(filename);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
    throw new Error(`Invalid GLB: ${filename}`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  const joints = new Set(json.skins.flatMap((skin) => skin.joints));
  const nodes = json.nodes.map((definition, index) => {
    const node = joints.has(index) ? new THREE.Bone() : new THREE.Object3D();
    node.name = definition.name ?? `Node${index}`;
    if (definition.matrix)
      new THREE.Matrix4()
        .fromArray(definition.matrix)
        .decompose(node.position, node.quaternion, node.scale);
    else {
      if (definition.translation)
        node.position.fromArray(definition.translation);
      if (definition.rotation)
        node.quaternion.fromArray(definition.rotation).normalize();
      if (definition.scale) node.scale.fromArray(definition.scale);
    }
    return node;
  });
  json.nodes.forEach((definition, index) =>
    (definition.children ?? []).forEach((child) =>
      nodes[index].add(nodes[child]),
    ),
  );
  const scene = new THREE.Group();
  for (const index of json.scenes[json.scene ?? 0].nodes)
    scene.add(nodes[index]);
  scene.updateMatrixWorld(true);
  const rest = nodes.map((node) => ({
    position: node.position.clone(),
    rotation: node.quaternion.clone(),
    scale: node.scale.clone(),
    worldPosition: node.getWorldPosition(new THREE.Vector3()),
    worldRotation: node.getWorldQuaternion(new THREE.Quaternion()),
  }));
  const depth = (node) => {
    let value = 0;
    for (let parent = node.parent; parent; parent = parent.parent) value++;
    return value;
  };
  const orderedJoints = [...joints].sort(
    (a, b) => depth(nodes[a]) - depth(nodes[b]),
  );
  const reset = () => {
    nodes.forEach((node, index) => {
      node.position.copy(rest[index].position);
      node.quaternion.copy(rest[index].rotation);
      node.scale.copy(rest[index].scale);
    });
    scene.updateMatrixWorld(true);
  };
  const accessor = (index) => {
    const definition = json.accessors[index],
      view = json.bufferViews[definition.bufferView];
    if (definition.componentType !== 5126 || definition.sparse)
      throw new Error("Combat tracks require nonsparse float accessors");
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[definition.type];
    if (!components)
      throw new Error(`Unsupported animation accessor: ${definition.type}`);
    const values = [],
      offset = (view.byteOffset ?? 0) + (definition.byteOffset ?? 0),
      stride = view.byteStride ?? components * 4;
    for (let frame = 0; frame < definition.count; frame++)
      for (let axis = 0; axis < components; axis++)
        values.push(binary.readFloatLE(offset + frame * stride + axis * 4));
    return values;
  };
  return { json, scene, nodes, rest, orderedJoints, reset, accessor };
}

function sourceClip(rig, animation) {
  const tracks = animation.channels.map((channel) => {
    const sampler = animation.samplers[channel.sampler];
    if (
      sampler.interpolation &&
      !["LINEAR", "STEP"].includes(sampler.interpolation)
    )
      throw new Error(
        `Unsupported combat interpolation: ${sampler.interpolation}`,
      );
    const property = {
      rotation: "quaternion",
      translation: "position",
      scale: "scale",
    }[channel.target.path];
    if (!property)
      throw new Error(`Unsupported combat channel: ${channel.target.path}`);
    const Track =
      property === "quaternion"
        ? THREE.QuaternionKeyframeTrack
        : THREE.VectorKeyframeTrack;
    return new Track(
      `${rig.nodes[channel.target.node].uuid}.${property}`,
      rig.accessor(sampler.input),
      rig.accessor(sampler.output),
      sampler.interpolation === "STEP"
        ? THREE.InterpolateDiscrete
        : THREE.InterpolateLinear,
    );
  });
  return new THREE.AnimationClip(animation.name, -1, tracks);
}

function bakeRetargetedClip(source, target, clip) {
  source.reset();
  target.reset();
  const sourceNames = new Map(
    source.nodes.map((node, index) => [node.name, index]),
  );
  const matches = target.orderedJoints.flatMap((index) => {
    const sourceIndex = sourceNames.get(target.nodes[index].name);
    return sourceIndex === undefined
      ? []
      : [{ index, sourceIndex, rotations: [] }];
  });
  const pelvis = target.nodes.find((node) => node.name === "pelvis");
  const sourcePelvis = source.nodes.find((node) => node.name === "pelvis");
  const sourceRoot = source.nodes.find((node) => node.name === "root");
  if (!pelvis?.parent || !sourcePelvis || !sourceRoot || matches.length < 50)
    throw new Error("Combat rigs are not compatible");
  const targetHip = pelvis.getWorldPosition(new THREE.Vector3()),
    sourceHip = sourcePelvis.getWorldPosition(new THREE.Vector3());
  const sourceRootRest = sourceRoot.getWorldPosition(new THREE.Vector3()),
    sourceOffset = sourceHip.clone().sub(sourceRootRest);
  const scale = targetHip.y / sourceHip.y;
  const mixer = new THREE.AnimationMixer(source.scene),
    action = mixer.clipAction(clip).play();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  const frames = Math.ceil(clip.duration * 30),
    times = [],
    translations = [];
  const rotation = new THREE.Quaternion(),
    parent = new THREE.Quaternion(),
    position = new THREE.Vector3();
  for (let frame = 0; frame <= frames; frame++) {
    const time = (frame / frames) * clip.duration;
    times.push(rounded(time));
    mixer.setTime(time);
    source.scene.updateMatrixWorld(true);
    target.reset();
    for (const match of matches) {
      const node = target.nodes[match.index],
        sourceNode = source.nodes[match.sourceIndex];
      sourceNode
        .getWorldQuaternion(rotation)
        .multiply(source.rest[match.sourceIndex].worldRotation.clone().invert())
        .multiply(target.rest[match.index].worldRotation);
      node.parent.getWorldQuaternion(parent);
      node.quaternion.copy(parent.invert().multiply(rotation)).normalize();
      if (node === pelvis) {
        position
          .copy(sourcePelvis.getWorldPosition(new THREE.Vector3()))
          .sub(sourceRoot.getWorldPosition(new THREE.Vector3()))
          .sub(sourceOffset)
          .multiplyScalar(scale)
          .add(targetHip);
        node.position.copy(node.parent.worldToLocal(position));
      }
      node.updateMatrixWorld(true);
      const values = node.quaternion.toArray();
      const previous = match.rotations.slice(-4);
      const sign =
        previous.length &&
        previous.reduce((sum, value, axis) => sum + value * values[axis], 0) < 0
          ? -1
          : 1;
      match.rotations.push(...values.map((value) => rounded(value * sign)));
    }
    translations.push(...pelvis.position.toArray().map(rounded));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(source.scene);
  const tracks = matches.map(
    (match) =>
      new THREE.QuaternionKeyframeTrack(
        `${target.nodes[match.index].name}.quaternion`,
        times,
        match.rotations,
      ),
  );
  tracks.push(
    new THREE.VectorKeyframeTrack("pelvis.position", times, translations),
  );
  const baked = new THREE.AnimationClip(
    clip.name,
    rounded(clip.duration),
    tracks,
  ).optimize();
  const json = THREE.AnimationClip.toJSON(baked);
  delete json.uuid;
  target.reset();
  return json;
}

const destination = path.join(project, "src", "assets", "animations");
const rigNames = ["hero", "enemy", "brondon", "brendan", "branden", "students"];
const bindPose = (target, complete = false) =>
  (complete
    ? target.orderedJoints.map((index) => target.nodes[index].name)
    : ["root", "pelvis", "upperarm_r", "thigh_r"]
  ).map((name) => {
    const bone = target.nodes.find((node) => node.name === name);
    if (!bone) throw new Error(`The target rig is missing ${name}`);
    return {
      name,
      position: bone.position.toArray().map(rounded),
      quaternion: bone.quaternion.toArray().map(rounded),
    };
  });

if (sourceDirectory === "--arcade") {
  const libraryPath = path.join(destination, "quaterniusCombat.json");
  const library = JSON.parse(await readFile(libraryPath, "utf8"));
  const source = await readRig(
    path.join(project, "src", "assets", "models", "Brondon.glb"),
  );
  const clips = library.rigs.brondon.map((serialized) =>
    THREE.AnimationClip.parse(serialized),
  );
  for (const [name, filename] of [
    ["brendan", "DonfromStreets.glb"],
    ["branden", "branden-the-dripless-export.glb"],
    ["students", "Caleb.glb"],
  ]) {
    const target = await readRig(
      path.join(project, "src", "assets", "models", filename),
    );
    library.bindPoses[name] = bindPose(target, true);
    library.rigs[name] = clips.map((clip) =>
      bakeRetargetedClip(source, target, clip),
    );
    console.log(`Retargeted ${clips.length} combat clips for ${name}`);
  }
  await writeFile(libraryPath, JSON.stringify(library));
} else if (sourceDirectory === "--brondon") {
  const libraryPath = path.join(destination, "quaterniusCombat.json");
  const library = JSON.parse(await readFile(libraryPath, "utf8"));
  const [source, target] = await Promise.all(
    ["MC.glb", "Brondon.glb"].map((name) =>
      readRig(path.join(project, "src", "assets", "models", name)),
    ),
  );
  library.bindPoses.brondon = bindPose(target);
  library.rigs.brondon = library.rigs.hero.map((serialized) =>
    bakeRetargetedClip(source, target, THREE.AnimationClip.parse(serialized)),
  );
  await writeFile(libraryPath, JSON.stringify(library));
  console.log(
    `Retargeted ${library.rigs.brondon.length} combat clips for Brondon`,
  );
} else {
  const sources = await Promise.all(
    ["UAL1_Standard.glb", "UAL2_Standard.glb"].map((name) =>
      readRig(path.join(sourceDirectory, name)),
    ),
  );
  const targets = await Promise.all(
    [
      "MC.glb",
      "Subject.glb",
      "Brondon.glb",
      "DonfromStreets.glb",
      "branden-the-dripless-export.glb",
      "Caleb.glb",
    ].map((name) =>
      readRig(path.join(project, "src", "assets", "models", name)),
    ),
  );
  const clips = sources.flatMap((source) =>
    source.json.animations
      .filter((animation) => selected.test(animation.name))
      .map((animation) => ({ source, clip: sourceClip(source, animation) })),
  );
  const output = {
    version: 1,
    license: "CC0-1.0",
    sources: [
      "Quaternius Universal Animation Library [Standard]",
      "Quaternius Universal Animation Library 2 [Standard]",
    ],
    bindPoses: Object.fromEntries(
      targets.map((target, index) => [
        rigNames[index],
        bindPose(target, index >= 3),
      ]),
    ),
    rigs: Object.fromEntries(
      targets.map((target, index) => [
        rigNames[index],
        clips.map(({ source, clip }) =>
          bakeRetargetedClip(source, target, clip),
        ),
      ]),
    ),
  };
  await mkdir(destination, { recursive: true });
  await writeFile(
    path.join(destination, "quaterniusCombat.json"),
    JSON.stringify(output),
  );
  console.log(
    `Imported ${clips.length} real combat/recovery clips for all game rigs (${clips.map(({ clip }) => clip.name).join(", ")})`,
  );
}
