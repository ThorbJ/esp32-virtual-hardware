// A viewer that records what the runtime asks of it, and lets a test click on nodes. Implements the runtime's viewer interface.
export function fakeViewer() {
  const handlers = [];
  const v = {
    images: [],          // { node, face, width, height, data (copy) }
    offsets: new Map(),  // node → offset or null
    rotations: new Map(),// node list joined (names; { node, path } as node/i/j) → turns [{ pivot, axis, angleDeg }, …]
    hidden: new Set(),   // hide patterns in force
    setScreenImage({ node, face }, image) { v.images.push({ node, face, width: image.width, height: image.height, data: image.data.slice() }); },
    setOffset(nodes, offset) { for (const n of nodes) v.offsets.set(n, offset); },
    setRotation(nodes, turns) { v.rotations.set(nodes.map((n) => (typeof n === 'string' ? n : `${n.node}/${n.path.join('/')}`)).join(','), turns); },
    setHidden(patterns, hidden) { for (const p of patterns) { if (hidden) v.hidden.add(p); else v.hidden.delete(p); } },
    onPick(nodes, handler) { const h = { nodes, handler }; handlers.push(h); return () => handlers.splice(handlers.indexOf(h), 1); },
    /** Simulate a click: phase 'down' | 'move' | 'up' on a node, with optional uv / point / nodeCenter. */
    pick(node, phase, extra = {}) {
      for (const h of handlers) if (h.nodes.includes(node)) h.handler({ node, phase, ...extra });
    },
    get pickable() { return handlers.flatMap((h) => h.nodes); },
    lastPixel(x, y) { const img = v.images.at(-1); const o = (y * img.width + x) * 4; return [...img.data.subarray(o, o + 3)]; },
  };
  return v;
}
