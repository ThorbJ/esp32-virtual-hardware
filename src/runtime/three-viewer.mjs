// A reference viewer for the web runtime, on three.js (peer dependency): loads a Kit model GLB, orbit / zoom, and implements
// the runtime's viewer interface (setScreenImage, onPick, setRotation, setOffset, setHidden). The shop's own viewer implements
// the same interface; this one is for development pages and for anyone embedding a virtual device without a viewer of their own.
// The node work (screen face, turns and offsets in the nodes' parent spaces, hidden nodes) is three-nodes.mjs.
//
//   const viewer = await createThreeViewer(container, { glbUrl, homeDirection: [0.35, 0.3, 0.88] });
//   const session = await startVirtualDevice({ pkg, viewer });
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createNodeControls } from './three-nodes.mjs';

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
  const gltf = await loader.loadAsync(glbUrl);
  const model = gltf.scene;
  scene.add(model); // the model stays in its own coordinates (mm): Kit model coordinates = world coordinates here
  model.updateMatrixWorld(true);
  const nodes = createNodeControls(THREE, model, gltf.parser);

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

  const centerOf = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const nameOf = (o) => o.userData?.name ?? o.name;

  // ---------- picking ----------
  const pickers = [];
  const ray = new THREE.Raycaster();
  let held = null;
  const hitAt = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    for (const hit of ray.intersectObject(model, true)) {
      if (!shown(hit.object)) continue; // hidden nodes (description hide) do not catch clicks
      for (let o = hit.object; o; o = o.parent) {
        const p = pickers.find((k) => k.nodes.includes(nameOf(o)));
        if (p) return { picker: p, node: nameOf(o), hit };
      }
      return null; // something else is in front
    }
    return null;
  };
  const report = (picker, node, phase, hit) => picker.handler({
    node, phase,
    uv: hit?.uv ? [hit.uv.x, hit.uv.y] : undefined,
    point: hit ? hit.point.toArray() : undefined,
    nodeCenter: centerOf(nodes.node(node)).toArray(),
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

  const { setScreenImage, setRotation, setOffset, setHidden } = nodes;
  return { THREE, renderer, scene, camera, controls, model, gltf, setScreenImage, onPick, setRotation, setOffset, setHidden };
}
