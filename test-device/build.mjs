#!/usr/bin/env node
// Build the test device and package it exactly as a real device is packaged:
//   firmware (test-device/firmware + the shared virtual hardware + its board layer) → build/test-device/
//   package  → fixtures/test-device/test-device.vdpkg.tgz, with its Kit model kit.glb and kit-manifest.json beside it.
//
//   node test-device/build.mjs            build and package (the source commit recorded in the package is git HEAD;
//                                         refuses uncommitted changes under test-device/ and vhw/, so the recorded commit is the source)
//   node test-device/build.mjs --dev      allow uncommitted changes (the package then records HEAD anyway: do not commit that package)
//   node test-device/build.mjs --no-pack  only build the firmware
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAll, link } from '../tools/emcc-build.mjs';
import { firmwareLinkFlags, vhwCompileFlags, vhwUnits } from '../tools/firmware.mjs';
import { buildPackage } from '../src/package/index.mjs';
import { kitGlb, MANIFEST } from './model.mjs';

const args = process.argv.slice(2);
const here = fileURLToPath(new URL('./', import.meta.url));
const repo = path.resolve(here, '..');
const out = path.join(repo, 'build/test-device');
const fixtures = path.join(repo, 'fixtures/test-device');
const template = JSON.parse(readFileSync(path.join(here, 'device.template.json'), 'utf8'));
const git = (...a) => execFileSync('git', a, { cwd: repo }).toString().trim();

if (!args.includes('--no-pack') && !args.includes('--dev')) {
  const dirty = git('status', '--porcelain', '--', 'test-device', 'vhw', 'tools', 'src');
  if (dirty) throw new Error(`uncommitted changes in the sources; commit them first (or --dev):\n${dirty}`);
}

const flags = vhwCompileFlags({ prefixMap: { [repo]: 'esp32-virtual-hardware' }, includes: [path.join(here, 'vhw')], virtualTime: template.runtime.virtualTime, mac: '02:54:45:53:54:01', defines: ['CONFIG_IDF_TARGET_ESP32S3=1', 'ESP_PLATFORM'] });
const units = [
  ...vhwUnits({ peripherals: ['ledc.c', 'panel_st7789.c'], idf: ['app_main.c', 'spi_master.c', 'usb_serial_jtag.c'] }),
  { src: path.join(here, 'vhw/board.c'), lang: 'c' },
  { src: path.join(here, 'firmware/main.c'), lang: 'c' },
].map((u) => ({ ...u, flags: u.lang === 'c' ? flags.c : flags.cxx }));

console.log(`test device: ${units.length} compile units`);
const objs = await compileAll(units, { objDir: path.join(out, 'obj'), force: args.includes('--force') });
const moduleFile = path.join(out, 'test-device.mjs');
await link(objs, {
  out: moduleFile,
  force: args.includes('--force'),
  flags: firmwareLinkFlags({ exportName: 'createTestDeviceFirmware', memoryMB: template.runtime.memoryMB, threads: template.runtime.threads }),
});
if (args.includes('--no-pack')) process.exit(0);

const head = git('rev-parse', 'HEAD');
const description = structuredClone(template);
description.firmware.upstream.commit = head;
description.firmware.virtualDevice.commit = head;
const files = new Map([
  ['firmware/test-device.mjs', readFileSync(moduleFile)],
  ['firmware/test-device.wasm', readFileSync(path.join(out, 'test-device.wasm'))],
  ['licenses/LICENSE', readFileSync(path.join(repo, 'LICENSE'))],
].map(([p, b]) => [p, new Uint8Array(b)]));
const { archive } = await buildPackage({ description, files });
mkdirSync(fixtures, { recursive: true });
writeFileSync(path.join(fixtures, 'test-device.vdpkg.tgz'), archive);
writeFileSync(path.join(fixtures, 'kit.glb'), kitGlb());
writeFileSync(path.join(fixtures, 'kit-manifest.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`);
console.log(`  ✓ fixtures/test-device/test-device.vdpkg.tgz (${archive.length} bytes, source ${head.slice(0, 7)})`);
