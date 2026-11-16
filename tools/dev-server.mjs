#!/usr/bin/env node
// Development web server (127.0.0.1 only) with the cross-origin isolation headers firmware threads need (COOP / COEP).
// Serves the dev page (dev/), the runtime and the fixtures of this repository; --root=<dir> serves another folder too
// under /extra/ (a device repository's build output, for example).
//
//   node tools/dev-server.mjs [--port=4180] [--root=<dir>]
//   open http://127.0.0.1:4180/dev/                       the test device
//   open http://127.0.0.1:4180/dev/?package=/extra/x.vdpkg.tgz&model=/extra/kit.glb   another package and Kit model
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.tgz': 'application/gzip', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
};
const ALLOWED = ['dev/', 'src/', 'device-description/', 'fixtures/', 'node_modules/three/'];

export function createDevServer({ extraRoot } = {}) {
  return http.createServer(async (req, res) => {
    const headers = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    };
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
      if (rel === '') { res.writeHead(302, { ...headers, Location: '/dev/' }); res.end(); return; }
      if (rel.endsWith('/')) rel += 'index.html';
      let base = repo;
      if (rel.startsWith('extra/') && extraRoot) { base = path.resolve(extraRoot); rel = rel.slice(6); }
      else if (!ALLOWED.some((a) => rel.startsWith(a))) throw new Error('forbidden');
      const file = path.resolve(base, rel);
      if (!file.startsWith(base)) throw new Error('forbidden');
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const port = Number(arg('port') || 4180);
  const server = createDevServer({ extraRoot: arg('root') });
  server.listen(port, '127.0.0.1', () => console.log(`virtual device dev page: http://127.0.0.1:${port}/dev/`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
}
