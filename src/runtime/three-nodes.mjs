// The node side of the runtime's viewer interface on a three.js scene loaded by GLTFLoader: the screen face, turns, offsets and
// hidden nodes (setScreenImage, setRotation, setOffset, setHidden; semantics in the header of index.mjs). No DOM, no WebGL:
// the reference viewer (three-viewer.mjs) uses it, and tests run it in Node. three is passed in so this file has no imports.
//
//   const gltf = await new GLTFLoader().loadAsync(url);
//   const nodes = createNodeControls(THREE, gltf.scene, gltf.parser);
//
// "Kit model coordinates" = the local space of `model` (gltf.scene). Nodes may sit under unnamed, rotated or scaled groups:
// a motion M given in Kit model coordinates is applied to a node as  local = parentInModel⁻¹ × M × restInModel  (exact, set as
// the node's matrix, so non-uniform scales above it are fine). restInModel is the node's place in the Kit model as loaded.
import { nodeNameMatches } from '../../device-description/validate.mjs';

export function createNodeControls(THREE, model, parser) {
  model.updateMatrixWorld(true);
  const modelInverse = () => model.matrixWorld.clone().invert();
  const inModel = (o) => modelInverse().multiply(o.matrixWorld);
  const nameOf = (o) => o.userData?.name ?? o.name; // GLTFLoader keeps the glTF name in userData.name (o.name is made unique)

  // Rest pose of every object, captured before anything moves.
  const rest = new Map();
  model.traverse((o) => rest.set(o, { local: o.matrix.clone(), inModel: inModel(o) }));
  const restCentre = new Map();

  // glTF node index ↔ object (GLTFLoader parser.associations), for nodes reached by child index paths.
  const indexOf = new Map();
  for (const [o, m] of parser?.associations ?? []) if (o.isObject3D && m?.nodes !== undefined && !indexOf.has(m.nodes)) indexOf.set(m.nodes, o);
  const nodeIndex = (o) => parser?.associations?.get(o)?.nodes;
  /** Follow glTF `children` indexes from an object; the object reached. */
  function down(from, path, what) {
    if (!path?.length) return from;
    const json = parser?.json;
    let i = nodeIndex(from);
    if (!json || i === undefined) throw new Error(`${what}: a path needs the GLTFLoader parser`);
    for (const step of path) {
      i = json.nodes[i]?.children?.[step];
      if (i === undefined) throw new Error(`${what}: ${nameOf(from)} has no node at path ${JSON.stringify(path)}`);
    }
    const o = indexOf.get(i);
    if (!o) throw new Error(`${what}: node ${i} is not in the scene`);
    return o;
  }

  /** A node reference: a name (the first node of that glTF name, depth first) or { node, path } (an unnamed node under it). */
  function node(ref) {
    const name = typeof ref === 'string' ? ref : ref.node;
    let found = null;
    model.traverse((o) => { if (!found && nameOf(o) === name) found = o; });
    if (!found) throw new Error(`the Kit model has no node ${name}`);
    return typeof ref === 'string' ? found : down(found, ref.path, 'node');
  }
  const centreAtRest = (name) => {
    if (!restCentre.has(name)) {
      const o = node(name);
      const box = new THREE.Box3();
      o.traverse((m) => {
        if (!m.isMesh) return;
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        box.union(g.boundingBox.clone().applyMatrix4(rest.get(m).inModel));
      });
      restCentre.set(name, box.getCenter(new THREE.Vector3()));
    }
    return restCentre.get(name).clone();
  };

  /** Place an object at motion × (its rest place), all in Kit model coordinates, through its current parent. */
  function place(o, motion) {
    const r = rest.get(o);
    o.parent.updateWorldMatrix(true, false);
    const local = inModel(o.parent).invert().multiply(motion).multiply(r.inModel);
    o.matrixAutoUpdate = false;
    o.matrix.copy(local);
    o.matrix.decompose(o.position, o.quaternion, o.scale); // kept roughly in step for code that reads them
    o.matrixWorldNeedsUpdate = true;
    o.updateMatrixWorld(true);
  }

  // ---------- the screen face ----------
  /** The mesh of the screen face: { node, face: { path, primitive } } as in the description. */
  function faceMesh({ node: name, face = {} }) {
    const path = face.path ?? [];
    const at = down(node(name), path, 'screen face');
    const k = face.primitive ?? 0;
    if (at.isMesh) {
      if (k !== 0) throw new Error(`screen face: the mesh under ${name} has one primitive, not ${k + 1}`);
      return at;
    }
    // A mesh with several primitives is a Group of Meshes, each associated with its primitive index.
    const mesh = at.children.find((c) => c.isMesh && parser?.associations?.get(c)?.primitives === k)
      ?? (parser ? null : at.children.filter((c) => c.isMesh)[k]);
    if (!mesh) throw new Error(`screen face: no mesh primitive ${k} at ${name} ${JSON.stringify(path)}`);
    return mesh;
  }

  const screens = new Map();
  function setScreenImage(target, image) {
    const key = JSON.stringify([target.node, target.face ?? {}]);
    let s = screens.get(key);
    if (!s) {
      const mesh = faceMesh(target);
      const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      mesh.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: mesh.material?.side ?? THREE.FrontSide });
      s = { texture };
      screens.set(key, s);
    }
    if (s.texture.image.data !== image.data) s.texture.image = { data: image.data, width: image.width, height: image.height };
    s.texture.needsUpdate = true;
  }

  // ---------- turns, offsets ----------
  const turnMatrix = ({ pivot, axis, angleDeg }) => {
    const p = Array.isArray(pivot) ? new THREE.Vector3(...pivot) : centreAtRest(pivot.node);
    const r = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...axis).normalize(), THREE.MathUtils.degToRad(angleDeg));
    return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(r).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  };
  function setRotation(names, turns) {
    const motion = new THREE.Matrix4();
    for (const t of Array.isArray(turns) ? turns : [turns]) motion.premultiply(turnMatrix(t)); // turns[0] first
    for (const o of names.map(node)) place(o, motion);
  }
  function setOffset(names, offset) {
    const motion = offset ? new THREE.Matrix4().makeTranslation(...offset) : new THREE.Matrix4();
    for (const o of names.map(node)) place(o, motion);
  }

  // ---------- hidden nodes ----------
  function setHidden(patterns, hidden) {
    model.traverse((o) => {
      const n = nameOf(o);
      if (typeof n === 'string' && n && patterns.some((p) => nodeNameMatches(p, n))) o.visible = !hidden;
    });
  }

  return { node, faceMesh, setScreenImage, setRotation, setOffset, setHidden };
}
