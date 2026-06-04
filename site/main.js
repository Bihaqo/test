import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const canvas = document.querySelector("#world");
const altitudeEl = document.querySelector("#altitude");
const speedEl = document.querySelector("#speed");
const onlineEl = document.querySelector("#online");
const enterButton = document.querySelector("#enter");
const regenButton = document.querySelector("#regen");
const crosshair = document.querySelector("#crosshair");
const animalMenu = document.querySelector("#animal-menu");
const exportAnimalButton = document.querySelector("#export-animal");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x86b9e3);
scene.fog = new THREE.FogExp2(0x86b9e3, 0.008);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 900);
camera.position.set(0, 26, 32);

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const sun = new THREE.DirectionalLight(0xfff2d0, 3.2);
sun.position.set(-70, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
sun.shadow.camera.left = -130;
sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130;
sun.shadow.camera.bottom = -130;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xaed5ff, 0x48503b, 2.1));

const terrainSize = 420;
const terrainSegments = 188;
let seed = Math.random() * 10000;
let terrain;
let features = new THREE.Group();
scene.add(features);
let animals = [];
let selectedAnimal = null;
let pendingAnimalDownloadUrl = null;
let pendingAnimalFilename = "";
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const gltfExporter = new GLTFExporter();
const remotePlayers = new Map();
let socket;
let playerId = "";
let myAvatar = null;
let lastNetworkSend = 0;

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
};
const velocity = new THREE.Vector3();
let canJump = false;
let lastTime = performance.now();

function hash(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = smoothstep(x - x0);
  const zf = smoothstep(z - z0);
  const a = hash(x0, z0);
  const b = hash(x0 + 1, z0);
  const c = hash(x0, z0 + 1);
  const d = hash(x0 + 1, z0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, xf),
    THREE.MathUtils.lerp(c, d, xf),
    zf,
  );
}

function fbm(x, z) {
  let total = 0;
  let amplitude = 0.58;
  let frequency = 0.018;
  let normalization = 0;

  for (let i = 0; i < 6; i += 1) {
    total += valueNoise(x * frequency, z * frequency) * amplitude;
    normalization += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }

  return total / normalization;
}

function terrainHeight(x, z) {
  const broad = fbm(x, z);
  const ridges = Math.pow(Math.abs(fbm(x + 140, z - 90) * 2 - 1), 1.9);
  const basin = Math.max(0, 1 - Math.hypot(x, z) / 230);
  return (broad - 0.43) * 50 + ridges * 18 + basin * 7;
}

function terrainColor(height, slopeSignal) {
  if (height < -6) return new THREE.Color(0x597f68);
  if (height < 6) return new THREE.Color(0x6f9b55).lerp(new THREE.Color(0xb1a264), slopeSignal);
  if (height < 21) return new THREE.Color(0x587a46).lerp(new THREE.Color(0x887c67), slopeSignal);
  return new THREE.Color(0xaeb1a2).lerp(new THREE.Color(0xf1f0dc), Math.min(1, (height - 20) / 24));
}

function buildTerrain() {
  if (terrain) {
    terrain.geometry.dispose();
    terrain.material.dispose();
    scene.remove(terrain);
  }

  features.clear();
  animals = [];
  const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
  geometry.rotateX(-Math.PI / 2);

  const colors = [];
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const height = terrainHeight(x, z);
    const slopeSignal = Math.abs(terrainHeight(x + 2, z) - terrainHeight(x, z + 2)) / 10;
    position.setY(i, height);
    terrainColor(height, Math.min(1, slopeSignal)).toArray(colors, i * 3);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
  });

  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);

  addWater();
  addTrees();
  addAnimals();
  placePlayer();
  remotePlayers.forEach((remote) => features.add(remote.avatar));
}

function colorFromStyle(style) {
  return new THREE.Color().setStyle(style);
}

function makePonyAvatar(avatar) {
  const pony = new THREE.Group();
  pony.userData.phase = Math.random() * Math.PI * 2;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colorFromStyle(avatar.body),
    roughness: 0.82,
  });
  const maneMaterial = new THREE.MeshStandardMaterial({
    color: colorFromStyle(avatar.mane),
    roughness: 0.76,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2428, roughness: 0.9 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
  const markMaterial = new THREE.MeshStandardMaterial({
    color: colorFromStyle(avatar.mark),
    roughness: 0.7,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), bodyMaterial);
  body.scale.set(1.85, 0.9, 1);
  body.position.y = 2.15;
  body.castShadow = true;

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 9), bodyMaterial);
  chest.scale.set(0.95, 1, 0.9);
  chest.position.set(1.42, 2.35, 0);
  chest.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.82, 12, 9), bodyMaterial);
  head.scale.set(0.94, 1.08, 0.86);
  head.position.set(2.1, 3.28, 0);
  head.castShadow = true;

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 7), bodyMaterial);
  snout.scale.set(1.1, 0.65, 0.72);
  snout.position.set(2.72, 3.12, 0);
  snout.castShadow = true;

  const earGeometry = new THREE.ConeGeometry(0.22, 0.72, 5);
  const leftEar = new THREE.Mesh(earGeometry, bodyMaterial);
  const rightEar = new THREE.Mesh(earGeometry, bodyMaterial);
  leftEar.position.set(1.84, 4.02, -0.36);
  rightEar.position.set(1.84, 4.02, 0.36);
  leftEar.rotation.z = -0.28;
  rightEar.rotation.z = -0.28;
  leftEar.castShadow = true;
  rightEar.castShadow = true;

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.35, 0.24), maneMaterial);
  mane.position.set(1.72, 3.42, 0);
  mane.rotation.z = -0.28;
  mane.castShadow = true;

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.65, 8), maneMaterial);
  tail.position.set(-1.92, 2.32, 0);
  tail.rotation.z = Math.PI / 2.9;
  tail.castShadow = true;

  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), markMaterial);
  mark.scale.set(0.22, 1, 1);
  mark.position.set(-0.38, 2.42, 1.03);

  const eyeGeometry = new THREE.SphereGeometry(0.08, 8, 6);
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(2.72, 3.36, -0.28);
  rightEye.position.set(2.72, 3.36, 0.28);

  const pupilGeometry = new THREE.SphereGeometry(0.04, 6, 5);
  const leftPupil = new THREE.Mesh(pupilGeometry, darkMaterial);
  const rightPupil = new THREE.Mesh(pupilGeometry, darkMaterial);
  leftPupil.position.set(2.78, 3.34, -0.3);
  rightPupil.position.set(2.78, 3.34, 0.3);

  const legGeometry = new THREE.CylinderGeometry(0.17, 0.22, 1.55, 7);
  const legs = [
    [-0.9, 0.58],
    [0.92, 0.58],
    [-0.9, -0.58],
    [0.92, -0.58],
  ].map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, bodyMaterial);
    leg.position.set(x, 0.98, z);
    leg.castShadow = true;
    pony.add(leg);
    return leg;
  });

  pony.add(
    body,
    chest,
    head,
    snout,
    leftEar,
    rightEar,
    mane,
    tail,
    mark,
    leftEye,
    rightEye,
    leftPupil,
    rightPupil,
  );
  pony.userData.legs = legs;
  pony.scale.setScalar(1.05);
  return pony;
}

function updateOnlineCount() {
  onlineEl.textContent = String(remotePlayers.size + 1);
}

function upsertRemotePlayer(player) {
  if (!player || player.id === playerId) return;

  let remote = remotePlayers.get(player.id);
  if (!remote) {
    const avatar = makePonyAvatar(player.avatar);
    remote = {
      avatar,
      target: new THREE.Vector3(),
      targetRotation: 0,
      moving: false,
    };
    remotePlayers.set(player.id, remote);
    features.add(avatar);
  }

  if (player.state) {
    remote.avatar.position.set(player.state.x, player.state.y - 6.2, player.state.z);
    remote.target.set(player.state.x, player.state.y - 6.2, player.state.z);
    remote.avatar.rotation.y = player.state.ry;
    remote.targetRotation = player.state.ry;
    remote.moving = player.state.moving;
  }

  updateOnlineCount();
}

function removeRemotePlayer(id) {
  const remote = remotePlayers.get(id);
  if (!remote) return;
  features.remove(remote.avatar);
  remotePlayers.delete(id);
  updateOnlineCount();
}

function updateRemotePlayers(delta, time) {
  remotePlayers.forEach((remote) => {
    remote.avatar.position.lerp(remote.target, Math.min(1, 9 * delta));
    remote.avatar.rotation.y = THREE.MathUtils.lerp(remote.avatar.rotation.y, remote.targetRotation, 8 * delta);

    const pace = remote.moving ? 0.42 : 0.08;
    remote.avatar.position.y += Math.sin(time * 0.005 + remote.avatar.userData.phase) * pace * delta;
    remote.avatar.userData.legs.forEach((leg, index) => {
      leg.rotation.x = remote.moving
        ? Math.sin(time * 0.012 + index * Math.PI) * 0.5
        : Math.sin(time * 0.003 + index) * 0.08;
    });
  });
}

function connectMultiplayer() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.addEventListener("open", () => {
    onlineEl.textContent = "1";
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "welcome") {
      playerId = message.id;
      myAvatar = message.avatar;
      seed = message.worldSeed;
      buildTerrain();
      message.players.forEach(upsertRemotePlayer);
      updateOnlineCount();
    }

    if (message.type === "join") {
      upsertRemotePlayer(message.player);
    }

    if (message.type === "leave") {
      removeRemotePlayer(message.id);
    }

    if (message.type === "state") {
      const remote = remotePlayers.get(message.id);
      if (!remote) return;
      remote.target.set(message.state.x, message.state.y - 6.2, message.state.z);
      remote.targetRotation = message.state.ry;
      remote.moving = message.state.moving;
    }

    if (message.type === "regen") {
      seed = message.worldSeed;
      buildTerrain();
    }
  });

  socket.addEventListener("close", () => {
    onlineEl.textContent = "offline";
    window.setTimeout(connectMultiplayer, 1200);
  });
}

function sendPlayerState(time) {
  if (!socket || socket.readyState !== WebSocket.OPEN || time - lastNetworkSend < 45) return;

  const object = controls.getObject();
  lastNetworkSend = time;
  socket.send(JSON.stringify({
    type: "state",
    state: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
      ry: object.rotation.y,
      moving: Math.hypot(velocity.x, velocity.z) > 1.5,
      avatar: myAvatar,
    },
  }));
}

function addWater() {
  const waterGeometry = new THREE.CircleGeometry(64, 96);
  waterGeometry.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0x2a84a5,
      transparent: true,
      opacity: 0.72,
      roughness: 0.18,
      metalness: 0,
      transmission: 0.18,
    }),
  );
  water.position.set(-74, -4.8, 58);
  features.add(water);
}

function addTrees() {
  const trunkGeometry = new THREE.CylinderGeometry(0.35, 0.52, 4.2, 6);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4c2f, roughness: 0.9 });
  const crownGeometry = new THREE.ConeGeometry(2.25, 6.4, 8);
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xc21f68, roughness: 0.95 });

  for (let i = 0; i < 150; i += 1) {
    const angle = hash(i, i + 8) * Math.PI * 2;
    const radius = 26 + hash(i + 3, i - 2) * 176;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = terrainHeight(x, z);

    if (y < -3 || y > 24 || Math.hypot(x + 74, z - 58) < 76) continue;

    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    const crown = new THREE.Mesh(crownGeometry, crownMaterial);
    trunk.position.y = 2;
    crown.position.y = 7;
    trunk.castShadow = true;
    crown.castShadow = true;
    tree.add(trunk, crown);
    tree.position.set(x, y, z);
    tree.rotation.y = hash(i + 40, i) * Math.PI;
    const scale = 0.72 + hash(i - 10, i + 20) * 0.56;
    tree.scale.setScalar(scale);
    features.add(tree);
  }
}

function makeAnimal(tint) {
  const animal = new THREE.Group();
  animal.userData.isAnimal = true;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.88 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x241a18, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1.45, 10, 8), bodyMaterial);
  body.scale.set(1.7, 0.82, 0.82);
  body.position.y = 1.7;
  body.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 9, 7), bodyMaterial);
  head.scale.set(1, 0.86, 0.82);
  head.position.set(2.35, 1.95, 0);
  head.castShadow = true;

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 8), darkMaterial);
  snout.rotation.z = -Math.PI / 2;
  snout.position.set(2.95, 1.9, 0);
  snout.castShadow = true;

  const earGeometry = new THREE.ConeGeometry(0.24, 0.54, 5);
  const leftEar = new THREE.Mesh(earGeometry, bodyMaterial);
  const rightEar = new THREE.Mesh(earGeometry, bodyMaterial);
  leftEar.position.set(2.18, 2.6, -0.34);
  rightEar.position.set(2.18, 2.6, 0.34);
  leftEar.castShadow = true;
  rightEar.castShadow = true;

  const legGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.35, 6);
  const legs = [
    [-0.92, 0.72],
    [0.92, 0.72],
    [-0.92, -0.72],
    [0.92, -0.72],
  ].map(([x, z]) => {
    const leg = new THREE.Mesh(legGeometry, darkMaterial);
    leg.position.set(x, 0.72, z);
    leg.castShadow = true;
    leg.userData.animal = animal;
    animal.add(leg);
    return leg;
  });

  [body, head, snout, leftEar, rightEar].forEach((part) => {
    part.userData.animal = animal;
  });

  animal.add(body, head, snout, leftEar, rightEar);
  animal.userData.legs = legs;
  return animal;
}

function addAnimals() {
  const tints = [0xd8b071, 0xc98b54, 0xf2e5cb, 0x9e7057, 0xe2c2a0];

  for (let i = 0; i < 46; i += 1) {
    const angle = hash(i + 80, i + 4) * Math.PI * 2;
    const radius = 14 + hash(i - 9, i + 33) * 184;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = terrainHeight(x, z);

    if (y < -5 || y > 29 || Math.hypot(x + 74, z - 58) < 68) continue;

    const animal = makeAnimal(tints[Math.floor(hash(i, i + 100) * tints.length)]);
    const scale = 0.72 + hash(i + 4, i + 14) * 0.52;
    animal.scale.setScalar(scale);
    animal.position.set(x, y, z);
    animal.rotation.y = hash(i + 44, i - 12) * Math.PI * 2;
    animal.userData.heading = animal.rotation.y;
    animal.userData.speed = 2.4 + hash(i + 9, i + 18) * 3.7;
    animal.userData.turn = 0;
    animal.userData.phase = hash(i + 30, i + 31) * Math.PI * 2;
    animals.push(animal);
    features.add(animal);
  }
}

function placePlayer() {
  const object = controls.getObject();
  object.position.set(10, terrainHeight(10, 10) + 8, 10);
  velocity.set(0, 0, 0);
}

function setMove(name, isMoving) {
  keys[name] = isMoving;
}

function updateMovement(delta) {
  const object = controls.getObject();
  const oldY = velocity.y;
  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  velocity.y -= 42 * delta;

  const direction = new THREE.Vector3(
    Number(keys.right) - Number(keys.left),
    0,
    Number(keys.backward) - Number(keys.forward),
  );

  if (direction.lengthSq() > 0) {
    direction.normalize();
    velocity.x -= direction.x * 86 * delta;
    velocity.z -= direction.z * 86 * delta;
  }

  if (keys.jump && canJump) {
    velocity.y = 14;
    canJump = false;
  }

  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);
  object.position.y += velocity.y * delta;

  const limit = terrainSize / 2 - 5;
  object.position.x = THREE.MathUtils.clamp(object.position.x, -limit, limit);
  object.position.z = THREE.MathUtils.clamp(object.position.z, -limit, limit);

  const ground = terrainHeight(object.position.x, object.position.z) + 6.2;
  if (object.position.y < ground) {
    velocity.y = Math.max(0, oldY);
    object.position.y = ground;
    canJump = true;
  }

  altitudeEl.textContent = `${Math.round(object.position.y - 6.2)} м`;
  speedEl.textContent = Math.round(Math.hypot(velocity.x, velocity.z)).toString();
}

function updateAnimals(delta, time) {
  const limit = terrainSize / 2 - 10;

  animals.forEach((animal, index) => {
    const data = animal.userData;
    data.turn -= delta;

    if (data.turn <= 0) {
      const wobble = hash(index + Math.floor(time * 0.001), index + 200) - 0.5;
      data.heading += wobble * 1.5;
      data.turn = 1.2 + hash(index + time * 0.0002, index - 50) * 2.4;
    }

    const nextX = animal.position.x + Math.sin(data.heading) * data.speed * delta;
    const nextZ = animal.position.z + Math.cos(data.heading) * data.speed * delta;
    const tooFar = Math.abs(nextX) > limit || Math.abs(nextZ) > limit;
    const tooWet = Math.hypot(nextX + 74, nextZ - 58) < 66;
    const nextY = terrainHeight(nextX, nextZ);
    const tooSteep = nextY < -6 || nextY > 31;

    if (tooFar || tooWet || tooSteep) {
      data.heading += Math.PI * (0.62 + hash(index, time * 0.001) * 0.76);
    } else {
      animal.position.x = nextX;
      animal.position.z = nextZ;
      animal.position.y = nextY;
    }

    animal.rotation.y = THREE.MathUtils.lerp(animal.rotation.y, data.heading, 5 * delta);
    animal.position.y += Math.sin(time * 0.006 + data.phase) * 0.045;

    data.legs.forEach((leg, legIndex) => {
      leg.rotation.x = Math.sin(time * 0.011 + data.phase + legIndex * Math.PI) * 0.36;
    });
  });
}

function hideAnimalMenu() {
  animalMenu.hidden = true;
  selectedAnimal = null;
  if (pendingAnimalDownloadUrl) {
    URL.revokeObjectURL(pendingAnimalDownloadUrl);
    pendingAnimalDownloadUrl = null;
  }
  pendingAnimalFilename = "";
  exportAnimalButton.disabled = false;
  exportAnimalButton.textContent = "Экспорт 3D";
}

function animalFromHit(hit) {
  let object = hit.object;

  while (object) {
    if (object.userData.animal) return object.userData.animal;
    if (object.userData.isAnimal) return object;
    object = object.parent;
  }

  return null;
}

function pickAnimal(event, useCenter = false) {
  if (useCenter) {
    pointer.set(0, 0);
  } else {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  }

  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(animals, true);
  return hits.length ? animalFromHit(hits[0]) : null;
}

function showAnimalMenu(event, animal, useCenter = false) {
  selectedAnimal = animal;
  if (pendingAnimalDownloadUrl) {
    URL.revokeObjectURL(pendingAnimalDownloadUrl);
    pendingAnimalDownloadUrl = null;
  }
  pendingAnimalFilename = "";
  exportAnimalButton.disabled = false;
  exportAnimalButton.textContent = "Экспорт 3D";
  animalMenu.hidden = false;
  const menuWidth = animalMenu.offsetWidth;
  const menuHeight = animalMenu.offsetHeight;
  const anchorX = useCenter ? window.innerWidth / 2 + 14 : event.clientX;
  const anchorY = useCenter ? window.innerHeight / 2 + 14 : event.clientY;
  const left = Math.min(anchorX, window.innerWidth - menuWidth - 8);
  const top = Math.min(anchorY, window.innerHeight - menuHeight - 8);
  animalMenu.style.left = `${Math.max(8, left)}px`;
  animalMenu.style.top = `${Math.max(8, top)}px`;
}

function prepareAnimalForExport(animal) {
  const exportRoot = animal.clone(true);
  exportRoot.position.set(0, 0, 0);
  exportRoot.rotation.set(0, 0, 0);

  exportRoot.traverse((object) => {
    object.userData = {};
    object.castShadow = false;
    object.receiveShadow = false;

    if (object.isMesh) {
      object.geometry = object.geometry.clone();
      object.material = object.material.clone();
    }
  });

  exportRoot.updateMatrixWorld(true);
  return exportRoot;
}

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function exportSelectedAnimal() {
  if (!selectedAnimal) return;

  if (pendingAnimalDownloadUrl) {
    downloadUrl(pendingAnimalDownloadUrl, pendingAnimalFilename);
    exportAnimalButton.textContent = "Скачать GLB";
    return;
  }

  exportAnimalButton.disabled = true;
  exportAnimalButton.textContent = "Готовлю...";
  const exportRoot = prepareAnimalForExport(selectedAnimal);

  gltfExporter.parse(
    exportRoot,
    (result) => {
      const blob = result instanceof ArrayBuffer
        ? new Blob([result], { type: "model/gltf-binary" })
        : new Blob([JSON.stringify(result, null, 2)], { type: "model/gltf+json" });
      pendingAnimalFilename = `animal-${Date.now()}.glb`;
      pendingAnimalDownloadUrl = URL.createObjectURL(blob);
      downloadUrl(pendingAnimalDownloadUrl, pendingAnimalFilename);
      exportAnimalButton.disabled = false;
      exportAnimalButton.textContent = "Скачать GLB";
    },
    (error) => {
      console.error("Animal export failed", error);
      exportAnimalButton.disabled = false;
      exportAnimalButton.textContent = "Ошибка экспорта";
    },
    { binary: true },
  );
}

function requestAnimalMenu(event, useCenter = false) {
  const animal = pickAnimal(event, useCenter);
  if (!animal) {
    hideAnimalMenu();
    return false;
  }

  if (controls.isLocked) controls.unlock();
  showAnimalMenu(event, animal, useCenter);
  return true;
}

function animate(time) {
  const delta = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;
  updateMovement(delta);
  updateAnimals(delta, time);
  updateRemotePlayers(delta, time);
  sendPlayerState(time);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyW" || event.code === "ArrowUp") setMove("forward", true);
  if (event.code === "KeyS" || event.code === "ArrowDown") setMove("backward", true);
  if (event.code === "KeyA" || event.code === "ArrowLeft") setMove("left", true);
  if (event.code === "KeyD" || event.code === "ArrowRight") setMove("right", true);
  if (event.code === "Space") keys.jump = true;
});

document.addEventListener("keyup", (event) => {
  if (event.code === "KeyW" || event.code === "ArrowUp") setMove("forward", false);
  if (event.code === "KeyS" || event.code === "ArrowDown") setMove("backward", false);
  if (event.code === "KeyA" || event.code === "ArrowLeft") setMove("left", false);
  if (event.code === "KeyD" || event.code === "ArrowRight") setMove("right", false);
  if (event.code === "Space") keys.jump = false;
});

document.querySelectorAll("[data-move]").forEach((button) => {
  const move = button.dataset.move;
  button.addEventListener("pointerdown", () => setMove(move, true));
  button.addEventListener("pointerup", () => setMove(move, false));
  button.addEventListener("pointercancel", () => setMove(move, false));
  button.addEventListener("pointerleave", () => setMove(move, false));
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 2) return;
  event.preventDefault();
  event.stopPropagation();
  requestAnimalMenu(event, controls.isLocked);
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
  requestAnimalMenu(event, controls.isLocked);
});

document.addEventListener("pointerdown", (event) => {
  if (animalMenu.hidden || animalMenu.contains(event.target)) return;
  hideAnimalMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Escape") hideAnimalMenu();
});

exportAnimalButton.addEventListener("click", exportSelectedAnimal);

enterButton.addEventListener("click", () => controls.lock());
controls.addEventListener("lock", () => {
  enterButton.hidden = true;
  crosshair.hidden = false;
  hideAnimalMenu();
});
controls.addEventListener("unlock", () => {
  enterButton.hidden = false;
  crosshair.hidden = true;
});

regenButton.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "regen" }));
  } else {
    seed = Math.random() * 10000;
    buildTerrain();
  }
});

window.addEventListener("resize", resize);

resize();
buildTerrain();
connectMultiplayer();
requestAnimationFrame(animate);
