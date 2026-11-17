// A complete, valid device description used by several tests (each test changes one thing in a copy).
export const sample = () => ({
  formatVersion: 2,
  device: { id: 'test-device' },
  appliesTo: { kit: 'test-kit', options: [] },
  firmware: {
    version: '0.1.0',
    upstream: { repo: 'https://github.com/ThorbJ/esp32-virtual-hardware', commit: '0123456789abcdef0123456789abcdef01234567' },
    virtualDevice: { repo: 'https://github.com/ThorbJ/esp32-virtual-hardware', commit: '0123456789abcdef0123456789abcdef01234567' },
    license: { spdx: 'MIT', unofficial: false, files: ['licenses/LICENSE'] },
  },
  runtime: { interfaceVersion: 3, module: 'firmware/test-device.mjs', memoryMB: 64, threads: 8, virtualTime: true },
  files: [
    { path: 'firmware/test-device.mjs', size: 3, sha256: 'a'.repeat(64) },
    { path: 'firmware/test-device.wasm', size: 3, sha256: 'b'.repeat(64) },
    { path: 'licenses/LICENSE', size: 3, sha256: 'c'.repeat(64) },
  ],
  channels: { in: ['button', 'hostRx', 'hostPresent'], out: ['screen', 'servo', 'hostTx', 'log'] },
  screen: { node: 'screen', panel: { width: 160, height: 128, format: 'rgb565' }, rotateCW: 0, area: { x: 0, y: 0, width: 1, height: 1 }, background: '#000000' },
  inputs: [{ kind: 'button', node: 'button', button: 0, press: { offsetMm: [0, -1.5, 0] } }],
  servos: [{ id: 0, nodes: ['arm'], pivot: { node: 'servo' }, axis: [0, 1, 0], zeroDeg: 90, direction: 1, scale: 1, approximate: { en: 'Arm angle follows the servo 1:1.', zh: '舵臂按舵机角度 1:1 转动。' } }],
  hostLink: { port: 47615, path: '/', protocol: 'test-echo' },
});
