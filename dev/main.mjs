// Dev page: one virtual device on its Kit model, with the reference three.js viewer and the web runtime.
// ?package=<archive url>&model=<glb url>&home=x,y,z&link=<ws url>; defaults to the test device fixture.
import { startVirtualDevice } from '../src/runtime/index.mjs';
import { createThreeViewer } from '../src/runtime/three-viewer.mjs';

const q = new URLSearchParams(location.search);
const archiveUrl = q.get('package') ?? '/fixtures/test-device/test-device.vdpkg.tgz';
const glbUrl = q.get('model') ?? '/fixtures/test-device/kit.glb';
const home = (q.get('home') ?? '0.35,0.3,0.88').split(',').map(Number);
const $ = (f) => document.querySelector(`[data-f="${f}"]`);
const logEl = document.getElementById('log');
const trafficEl = document.getElementById('traffic');
const hex = (b) => [...b.slice(0, 48)].map((x) => x.toString(16).padStart(2, '0')).join(' ') + (b.length > 48 ? ' …' : '');

const viewer = await createThreeViewer(document.getElementById('stage'), { glbUrl, homeDirection: home });
const session = await startVirtualDevice({
  source: { archiveUrl },
  viewer,
  hostLink: q.get('link') ? { url: q.get('link') } : true,
  onStatus: (s) => {
    $('phase').textContent = s.error ? `${s.phase}: ${s.error.code} ${s.error.message}` : s.phase;
    if (s.progress) $('progress').textContent = `${s.progress.loaded} / ${s.progress.total} bytes`;
    $('power').textContent = `${s.power} / ${s.bootCount}`;
    $('link').textContent = `${s.link} (attempts ${s.linkAttempts})`;
  },
});
window.vdev = { session, viewer };
const fw = session.description.firmware;
$('firmware').textContent = `${fw.version} · ${fw.upstream.repo} @ ${fw.upstream.commit.slice(0, 7)} · ${fw.license.spdx}`;
session.on('log', (t) => { logEl.textContent = (logEl.textContent + t).slice(-50_000); logEl.scrollTop = logEl.scrollHeight; });
session.on('traffic', ({ direction, bytes }) => { trafficEl.textContent = `${trafficEl.textContent}${direction === 'rx' ? '→ dev' : '← dev'} ${bytes.length} B  ${hex(bytes)}\n`.slice(-50_000); });
document.getElementById('repower').addEventListener('click', () => { logEl.textContent = ''; session.repower(); });
document.getElementById('mic').addEventListener('change', (e) => session.setMic(e.target.checked));
document.getElementById('camera').addEventListener('change', (e) => session.setCamera(e.target.checked));
