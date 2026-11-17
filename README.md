# esp32-virtual-hardware

Run unmodified ESP32 firmware in the browser.

The firmware's own source (ESP-IDF or Arduino-ESP32) is compiled to WebAssembly as it is. Only the lowest layer, the code that drives the chip's peripherals, is replaced by virtual hardware. A web page then shows the device on its 3D model: the screen is drawn on the model's screen, clicks on the model's buttons, joystick and touch screen become real inputs, servos turn the model's parts, and the speaker, microphone and camera are the computer's. Where the real device talks to a program on a computer over USB, the virtual one talks to the same program over a local WebSocket.

This repository holds what every device shares. Each device has its own repository with its device-specific layer and build, for example [brufik-virtual](https://github.com/ThorbJ/brufik-virtual) and [hachimodock-virtual](https://github.com/ThorbJ/hachimodock-virtual).

中文：让 ESP32 的真固件原样在浏览器里运行。固件源码直接编译成 WebAssembly，只把操作芯片外设的最底层换成虚拟硬件；本仓库是所有设备共用的那一层：虚拟设备接口、共用虚拟硬件、设备说明的格式和网页运行时，外加一台用来测试的"测试小设备"。

## What is in it

| Folder | What |
|---|---|
| `src/interface/` | **Virtual device interface**: the one boundary between a firmware and the outside world, the same in the browser and in Node. In: buttons, joystick, touch, microphone, camera, bytes from the computer, computer present. Out: screen frames, servo angles, speaker, bytes to the computer, log. Device clock; power on, off, restart; `runUntil(ms)` parks a virtual-time device at an exact device time, so scripted inputs give identical runs. |
| `vhw/` | **Virtual hardware** (C): FreeRTOS on WebAssembly threads with a virtual clock (deterministic) or real time, NVS in memory, timers, random numbers, a fixed virtual MAC, GPIO, LEDC, I2S, SPI with an ST7789 screen model, the ESP-IDF start-up, `spi_master` and USB Serial/JTAG drivers, and an Arduino-ESP32 layer. `vhw/include/vdev_io.h` is the C side of the interface. (Older comments in the C sources are in Chinese.) |
| `device-description/` | **Device description format** (设备说明), version 2: its written definition, a dependency-free validator and a JSON Schema. See [device-description/README.md](device-description/README.md). |
| `src/package/` | **Virtual device package**: build and read the one-file archive (`*.vdpkg.tgz`) holding a firmware build and its device description. No dependencies. |
| `src/runtime/` | **Web runtime**: one device-independent interface for a page. Given a package and a viewer, it loads the firmware, wires screen, inputs, servos, speaker, microphone, camera and the computer connection, and reports status. `three-viewer.mjs` is a reference viewer on three.js. |
| `test-device/` | **The test device** (测试小设备): a tiny real ESP-IDF firmware built with this layer, its board layer, a code-generated Kit model and its description template. |
| `fixtures/test-device/` | Its built package `test-device.vdpkg.tgz` (about 30 KB), Kit model `kit.glb` and `kit-manifest.json`, committed for other projects' tests. |
| `tools/` | Build helpers for device repositories (`firmware.mjs` build profile, `emcc-build.mjs` incremental build, `upstream.mjs` pinned upstream sources), the dev server, and `dev-bridge/` (development only). |
| `dev/` | A development page: the test device (or any package) on its Kit model. |
| `tests/` | Node tests (`node --test`, no browser). |

## Use it from another project (pin a version)

Not published to npm. Reference a tagged commit of this repository, never a branch:

```jsonc
// package.json
"dependencies": {
  // the commit the tag points to (Releases, or `git ls-remote --tags https://github.com/ThorbJ/esp32-virtual-hardware`);
  // the tag name alone (#v0.1.0) also works, the commit cannot move
  "esp32-virtual-hardware": "github:ThorbJ/esp32-virtual-hardware#<commit of v0.1.0>"
}
```

Entry points (`exports`): `esp32-virtual-hardware/runtime`, `/runtime/three-viewer`, `/runtime/three-nodes`, `/interface`, `/interface/node`, `/device-description`, `/device-description/schema.json`, `/package`, `/tools/*`, `/fixtures/*`. Everything is plain ES modules (`.mjs`) with no runtime dependencies (`three` only for the optional reference viewer). The device description validator is one file and may be copied instead (keep its header and version).

The interface version (`vhw/include/vdev_io.h` `VDEV_IO_VERSION`, `src/interface/io-layout.mjs` `VERSION`, a description's `runtime.interfaceVersion`, now 3) must match between the runtime and the firmware build: a package built against another version is refused. Releases that change it are new minor (0.x) or major versions.

## Web runtime

```js
import { loadPackage, startVirtualDevice } from 'esp32-virtual-hardware/runtime';

const pkg = await loadPackage({ archiveUrl }, { onProgress: ({ loaded, total }) => {} });   // one archive file, or
const pkg = await loadPackage({ description, fileUrls: { 'firmware/x.mjs': url /* … */ } }); // files stored one by one (any URLs)
const session = await startVirtualDevice({ pkg, viewer, onStatus: (s) => {} });
session.on('traffic', ({ direction, bytes }) => {});   // also 'status', 'log', 'power'
session.repower(); session.setMic(true); session.setCamera(true);
await session.dispose();
```

- The page must be **cross-origin isolated** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`); otherwise `startVirtualDevice` fails with status error `not_cross_origin_isolated`.
- **Downloads on a flaky network**: each file is fetched with `downloadFile` (also exported, for anything else big the page loads). A try that brings no byte for 15 s, or whose connection breaks, is resumed from the first missing byte (HTTP `Range` with `If-Range`; a server that answers with the whole file is read from the start), with growing pauses; it gives up after 4 tries in a row that brought nothing, with error code `download_failed`. Options `stallMs`, `retries`, `retryDelayMs`, `onRetry` on `loadPackage` and `downloadFile`. Serve the files with Range support.
- Package files are checked (sizes, sha256) and turned into blob URLs; the firmware module is imported from there, so it does not matter under which URLs or storage keys the files are served.
- **Status**: `phase` (`loading` → `starting` → `running`; `off`, `error`), `progress`, `power`, `bootCount`, `link` (`none` / `waiting` / `connected` / `elsewhere` / `closed`), `linkAttempts`, `speaker`, `mic`, `camera`, `error { code, message }`. States, not words: the page decides what to show.
- **Computer connection**: straight to the computer-side program's local WebSocket `ws://127.0.0.1:<port><path>` from the description, bytes as they are. Without the program the device runs like a real one not plugged in, and the link keeps trying, so starting the program later connects without a reload. The program should check the `Origin` header (a page at `https://example.com` sends `Origin: https://example.com`).
- **One tab at a time**: a computer-side program takes one device and a newer connection replaces the older one, so two tabs of the same page would knock each other off on every retry. Where the browser has Web Locks, a link connects only while it holds the lock named after its address (`hostLinkLockName(url)`, shared by every tab of the origin). Another tab reports `link: 'elsewhere'` and opens no socket; it connects by itself when the holder lets go (tab closed, `dispose()`), or at once with `session.takeOverLink()`, which leaves the former holder `elsewhere` (it does not try to win it back).
- **Hidden tabs**: browsers run a hidden tab's timers about once a second, or not at all for 10 s and more, while network events still arrive. The page's poll is a timer, so `hostWrite` (every message from the computer) also hands out what the device has sent the computer and takes the latest screen frame: replies to the computer go out at the latest on its next message (desktop programs send at least a heartbeat every couple of seconds). **Known limitation**: a panel that hands over frame by frame under virtual time (`vdev_screen_wait_consumed`, e.g. `panel_st7789.c`) still waits, in virtual time, for its frame to be taken, so while the timer stalls between two computer messages the firmware's drawing thread can sit in that wait; changing it means rebuilding every device package, so it is left for a later release.
- **Viewer interface** (the page's 3D viewer implements it): `setScreenImage({ node, face }, { width, height, data })`, `onPick(nodes, handler)`, `setRotation(nodes, [{ pivot, axis, angleDeg }, …])`, `setOffset(nodes, offset)`, `setHidden(patterns, hidden)`. Exact semantics are in the header of `src/runtime/index.mjs`. Everything is in Kit model coordinates; nodes may sit under unnamed rotated groups, so a viewer converts each motion into the node's parent space. `src/runtime/three-viewer.mjs` is a working implementation (its node work, testable without WebGL, is `src/runtime/three-nodes.mjs`, export `esp32-virtual-hardware/runtime/three-nodes`). The pure computations (screen texture, texture coordinates → panel pixels, servo joint angles, joystick) are in `src/runtime/geometry.mjs`.

## Build and test

Needs Node 22+ for everything; the firmware builds also need [Emscripten](https://emscripten.org) (`emcc`, tested with 7.0.0) and git. The tests use the committed test device package, so they run without Emscripten.

```sh
npm install             # dev dependencies only: ajv (schema cross-check), three (dev page)
npm test                # all Node tests, about 15 s
npm run build:test-device -- --dev     # rebuild the test device into build/ and fixtures/ (needs emcc)
npm run dev             # dev page with COOP/COEP on http://127.0.0.1:4180/dev/
```

`node test-device/build.mjs` without `--dev` refuses uncommitted source changes, because the package records the commit it was built from (`firmware.upstream.commit`, `firmware.virtualDevice.commit`). Commit the sources first, then build and commit the package.

## Build a device

A device repository pins its upstream firmware in `upstream.lock.json` (fetched by `tools/upstream.mjs`, never modified), adds its device layer (board pins, peripherals this layer does not have) and a `build.mjs` that compiles the upstream sources, the shared layer (`vhwUnits`, `vhwCompileFlags` from `tools/firmware.mjs`) and its layer with `compileAll` / `link` (`tools/emcc-build.mjs`) using `firmwareLinkFlags`, then packs with `buildPackage` (`src/package`). `test-device/build.mjs` is the smallest complete example.

## Development bridge

For a computer-side program that does not have the virtual device connection yet: `node tools/dev-bridge/bridge.mjs --port=<port> --tty=<path>` listens where the program would and relays the bytes to a pseudo-terminal the unchanged program opens as a serial port (macOS / Linux, development only).

## License

MIT. A device build that links this code with firmware under another license (GPL-3.0, for example) is covered by that license as a whole.
