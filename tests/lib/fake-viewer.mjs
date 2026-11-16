// A viewer that records what the runtime asks of it, and lets a test click on nodes. Implements the runtime's viewer interface.
export function fakeViewer() {
  const handlers = [];
  const v = {
    images: [],          // { node, materialIndex, width, height, data (copy) }
    offsets: new Map(),  // node → offset or null
    rotations: new Map(),// node list joined → { pivot, axis, angleDeg }
    setScreenImage(node, materialIndex, image) { v.images.push({ node, materialIndex, width: image.width, height: image.height, data: image.data.slice() }); },
    setOffset(nodes, offset) { for (const n of nodes) v.offsets.set(n, offset); },
    setRotation(nodes, spec) { v.rotations.set(nodes.join(','), spec); },
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
