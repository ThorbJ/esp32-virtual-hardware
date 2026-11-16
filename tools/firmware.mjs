// The shared build profile of a virtual device firmware: where the virtual hardware lives, which of its sources to compile,
// the compile flags every firmware needs and the link flags that make a module the web runtime can load.
// A device build (its own build.mjs) adds the upstream sources and its device layer, then calls compileAll / link.
//
//   import { vhwUnits, vhwCompileFlags, firmwareLinkFlags } from 'esp32-virtual-hardware/tools/firmware.mjs';
//   import { compileAll, link } from 'esp32-virtual-hardware/tools/emcc-build.mjs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../vhw/', import.meta.url));

export const VHW = Object.freeze({
  root,
  include: path.join(root, 'include'),
  src: path.join(root, 'src'),
  idf: path.join(root, 'idf'),
  arduinoInclude: path.join(root, 'arduino/include'),
  arduinoSrc: path.join(root, 'arduino/src'),
  newlibCompat: path.join(root, 'include/vhw_newlib_compat.h'),
});

/** The core virtual hardware every firmware links. */
export const CORE_SOURCES = Object.freeze(['vdev_io.c', 'system.c', 'nvs.c', 'gpio_spi.c', 'freertos.c', 'freertos_vt.c']);
/** Optional shared peripherals (a device layer that models the same peripheral itself leaves them out). */
export const PERIPHERAL_SOURCES = Object.freeze(['ledc.c', 'i2s.c', 'panel_st7789.c']);
/** Optional ESP-IDF pieces: start-up (app_main) and drivers. */
export const IDF_SOURCES = Object.freeze(['app_main.c', 'spi_master.c', 'usb_serial_jtag.c']);

/**
 * Compile units of the shared layer: { src, lang }.
 * peripherals / idf: which optional sources (file names from the lists above); arduino: true adds the Arduino-ESP32 layer
 * (it needs the portable Arduino core files from upstream arduino-esp32 on the include path).
 */
export function vhwUnits({ peripherals = PERIPHERAL_SOURCES, idf = [], arduino = false } = {}) {
  const units = [];
  for (const f of [...CORE_SOURCES, ...peripherals]) units.push({ src: path.join(VHW.src, f), lang: 'c' });
  for (const f of idf) {
    if (!IDF_SOURCES.includes(f)) throw new Error(`unknown IDF source ${f}`);
    units.push({ src: path.join(VHW.idf, f), lang: 'c' });
  }
  if (arduino) {
    for (const f of readdirSync(VHW.arduinoSrc).sort()) if (/\.(c|cpp)$/.test(f)) units.push({ src: path.join(VHW.arduinoSrc, f), lang: /\.c$/.test(f) ? 'c' : 'c++' });
  }
  return units;
}

/**
 * Compile flags: { c, cxx }. includes: device include folders, searched before the shared ones (a device header wins).
 * virtualTime: deterministic FreeRTOS on a virtual clock (vhw/src/freertos_vt.c) instead of real time.
 * mac: the device's fixed virtual MAC 'aa:bb:cc:dd:ee:ff' (locally administered).
 * prefixMap: { '/absolute/folder': 'name' }: source paths that end up in the build (__FILE__ in assertions and logs) are
 * written with these names instead of local absolute paths. This repository's folder is always mapped to esp32-virtual-hardware.
 */
export function vhwCompileFlags({ defines = [], includes = [], virtualTime = true, mac, arduino = false, opt = '-O2', prefixMap = {} } = {}) {
  const all = [
    ...defines,
    ...(virtualTime ? ['VHW_VIRTUAL_TIME=1'] : []),
    ...(mac ? [`VDEV_VIRTUAL_MAC=0x${mac.replace(/:/g, '')}ull`] : []),
  ];
  const inc = [...includes, ...(arduino ? [VHW.arduinoInclude] : []), VHW.include];
  const maps = { [path.dirname(VHW.root.replace(/\/$/, ''))]: 'esp32-virtual-hardware', ...prefixMap };
  const common = [opt, '-pthread', '-fno-exceptions', '-Wno-everything',
    ...Object.entries(maps).map(([from, to]) => `-ffile-prefix-map=${from.replace(/\/$/, '')}=${to}`),
    // newlib flavour (as the ESP32 toolchain): C library functions without C++ const overloads, a few newlib macros
    '-D__CORRECT_ISO_CPP_STRING_H_PROTO', '-include', VHW.newlibCompat,
    ...all.map((d) => `-D${d}`), ...inc.map((i) => `-I${i}`)];
  return { c: [...common, '-std=gnu17'], cxx: [...common, '-std=gnu++2b'] };
}

// Emscripten's default list of options a page may pass to the module factory, plus mainScriptUrlOrBlob: the web runtime
// passes the module's real URL there, so the firmware threads start from it wherever the files are served (any key, blob URLs).
const INCOMING = ['ENVIRONMENT', 'arguments', 'canvas', 'dynamicLibraries', 'elementPointerLock', 'instantiateWasm', 'locateFile',
  'monitorRunDependencies', 'noExitRuntime', 'noInitialRun', 'onAbort', 'onExit', 'onRuntimeInitialized', 'postRun', 'preInit', 'preRun',
  'print', 'printErr', 'setStatus', 'statusMessage', 'stderr', 'stdin', 'stdout', 'thisProgram', 'wasm', 'websocket', 'mainScriptUrlOrBlob'];

/**
 * Link flags of a firmware module: an ES module factory (export default) for the browser and Node, with the interface exports
 * the runtime needs. memoryMB / threads: the device description's runtime.memoryMB / runtime.threads (keep them equal).
 */
export function firmwareLinkFlags({ exportName, memoryMB, threads, exported = [], extra = [], opt = '-O2' }) {
  return [
    opt, '-pthread',
    '-sPROXY_TO_PTHREAD', '-sEXIT_RUNTIME=1',
    `-sPTHREAD_POOL_SIZE=${threads}`,
    `-sINITIAL_MEMORY=${memoryMB * 1024 * 1024}`, '-sALLOW_MEMORY_GROWTH=0',
    `-sDEFAULT_PTHREAD_STACK_SIZE=${256 * 1024}`, `-sSTACK_SIZE=${1024 * 1024}`,
    '-sMODULARIZE', '-sEXPORT_ES6', `-sEXPORT_NAME=${exportName}`, '-sENVIRONMENT=web,worker,node',
    `-sINCOMING_MODULE_JS_API=${INCOMING.join(',')}`,
    `-sEXPORTED_FUNCTIONS=${['_main', '_vdev_io', '_emscripten_force_exit', '_malloc', '_free', ...exported].join(',')}`,
    '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32',
    ...extra,
  ];
}
