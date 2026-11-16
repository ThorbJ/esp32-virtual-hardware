// A reference viewer for the web runtime, on three.js (peer dependency): loads a Kit model GLB, orbit / zoom, and implements
// the runtime's viewer interface (setScreenImage, onPick, setRotation, setOffset). The shop's own viewer implements the same
// interface; this one is for development pages and for anyone embedding a virtual device without a viewer of their own.
//
//   const viewer = await createThreeViewer(container, { glbUrl, homeDirection: [0.35, 0.3, 0.88] });
//   const session = await startVirtualDevice({ pkg, viewer });
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function createThreeViewer(container, { glbUrl, homeDirection = [1, 0.5, 1.5], background = 0xeef0f3 }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const model = (await loader.loadAsync(glbUrl)).scene;
  scene.add(model); // the model stays in its own coordinates (mm): Kit model coordinates = world coordinates here
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  camera.position.copy(center).addScaledVector(new THREE.Vector3(...homeDirection).normalize(), radius * 3.4);
  camera.near = radius / 50;
  camera.far = radius * 50;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  const node = (name) => {
    const o = model.getObjectByName(name);
    if (!o) throw new Error(`the Kit model has no node ${name}`);
    return o;
  };
  const rest = new Map(); // node → { position, quaternion } as loaded
  const restOf = (o) => {
    if (!rest.has(o)) rest.set(o, { position: o.position.clone(), quaternion: o.quaternion.clone() });
    return rest.get(o);
  };
  const centerOf = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());

  // ---------- screen ----------
  const screens = new Map();
  function setScreenImage(name, materialIndex, image) {
    let s = screens.get(name);
    if (!s) {
      const mesh = node(name);
      const target = mesh.isMesh ? mesh : mesh.getObjectByProperty('isMesh', true);
      const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      const multi = Array.isArray(target.material);
      const mats = multi ? [...target.material] : [target.material];
      const i = multi ? (materialIndex ?? 0) : 0;
      mats[i] = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      target.material = multi ? mats : mats[0];
      s = { texture };
      screens.set(name, s);
    }
    if (s.texture.image.data !== image.data) s.texture.image = { data: image.data, width: image.width, height: image.height };
    s.texture.needsUpdate = true;
  }

  // ---------- picking ----------
  const pickers = [];
  const ray = new THREE.Raycaster();
  let held = null;
  const hitAt = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    for (const hit of ray.intersectObject(model, true)) {
      for (let o = hit.object; o; o = o.parent) {
        const p = pickers.find((k) => k.nodes.includes(o.name));
        if (p) return { picker: p, node: o.name, hit };
      }
      return null; // something else is in front
    }
    return null;
  };
  const report = (picker, node, phase, hit) => picker.handler({
    node, phase,
    uv: hit?.uv ? [hit.uv.x, hit.uv.y] : undefined,
    point: hit ? hit.point.toArray() : undefined,
    nodeCenter: centerOf(model.getObjectByName(node)).toArray(),
  });
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (ev) => {
    const h = hitAt(ev);
    if (!h) return;
    held = h;
    controls.enabled = false;
    el.setPointerCapture(ev.pointerId);
    report(h.picker, h.node, 'down', h.hit);
  });
  el.addEventListener('pointermove', (ev) => {
    if (!held) return;
    const h = hitAt(ev);
    if (h && h.node === held.node) report(held.picker, held.node, 'move', h.hit);
  });
  const up = () => {
    if (!held) return;
    report(held.picker, held.node, 'up', null);
    held = null;
    controls.enabled = true;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  function onPick(nodes, handler) {
    const p = { nodes, handler };
    pickers.push(p);
    return () => pickers.splice(pickers.indexOf(p), 1);
  }

  // ---------- servos, press ----------
  function setRotation(names, { pivot, axis, angleDeg }) {
    const objs = names.map(node);
    const pv = Array.isArray(pivot) ? new THREE.Vector3(...pivot) : centerOf(node(pivot.node));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), THREE.MathUtils.degToRad(angleDeg));
    for (const o of objs) {
      const r = restOf(o);
      // rotate the rest pose about the pivot (nodes are children of the model root here: their parent space = model space)
      o.position.copy(r.position).sub(pv).applyQuaternion(q).add(pv);
      o.quaternion.copy(q).multiply(r.quaternion);
    }
  }
  function setOffset(names, offset) {
    for (const o of names.map(node)) {
      const r = restOf(o);
      o.position.copy(r.position);
      if (offset) o.position.add(new THREE.Vector3(...offset));
    }
  }

  return { THREE, renderer, scene, camera, controls, model, setScreenImage, onPick, setRotation, setOffset };
}
