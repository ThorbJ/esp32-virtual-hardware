# Device description (设备说明), format version 1

A **device description** is the `device.json` file inside every virtual device package. It says what the package is for, where its firmware comes from, how the firmware's screen, inputs and servos map onto the Kit model, which interface channels it uses and how it reaches the computer-side program. The packing script writes it; the shop's checker and the web runtime read it. The page and the checker know nothing about any particular device beyond what is written here.

This folder is the contract:

| File | What it is |
|---|---|
| `README.md` | This definition (the reference when anything disagrees). |
| `validate.mjs` | The validator: one plain JavaScript module, no dependencies (browsers, Node 22+, Cloudflare Workers). Copy it as it is, or import `esp32-virtual-hardware/device-description`. Checks the structure and the rules below, and a package's files. |
| `schema.json` | The same structure as JSON Schema 2020-12, for editors and other languages. The cross-field rules (marked *rule* below) are only in `validate.mjs`. |

`formatVersion` is `1`. Any change to the fields (added, removed, renamed, meaning changed) makes a new format version and a new release of this repository; a validator accepts only the version it was written for. Unknown fields are refused, so typos do not pass silently.

## Package archive

A package is one file, `*.vdpkg.tgz`: a gzip-compressed POSIX tar (ustar) of regular files only.

```
device.json               this description
firmware/<name>.mjs       the firmware module (emscripten ES module factory), named by runtime.module
firmware/<name>.wasm      its other build outputs (.wasm, preloaded .data), each listed in files
licenses/<file>           licence texts the firmware's licence asks to ship with it (optional, listed in files)
```

Nothing else: no keys, no personal data, no other folders. `src/package/index.mjs` builds and reads it (`buildPackage`, `readPackage`). A package is at most `PACKAGE_MAX_BYTES` (32 MB) in all.

## Fields

Paths are written `a.b[0].c`. "Node" always means the name of a node in the Kit model GLB the package is used with. "Kit model coordinates" are those of the GLB scene as it is (mm).

### Top level

| Field | Required | Meaning |
|---|---|---|
| `formatVersion` | yes | `1`. |
| `device` | yes | `{ id }`: a short id of the device build, lower-case letters, digits, `-` and `_` (`brufik`, `hachimodock`, `test-device`). |
| `appliesTo` | yes | `{ kit, options }`: the Kit this package is for (the shop's Kit identifier) and the Options it is built for (`[]` = the Kit's default configuration; otherwise the identifiers of the hardware-changing Options, each once). |
| `firmware` | yes | Where the firmware comes from, see below. |
| `runtime` | yes | How to start the firmware, see below. |
| `files` | yes | Every file of the package except `device.json`: `[{ path, size, sha256 }]`. |
| `channels` | yes | `{ in, out }`: the interface channels the firmware uses. In: `button`, `joystick`, `touch`, `mic`, `camera`, `hostRx`, `hostPresent`. Out: `screen`, `servo`, `speaker`, `hostTx`, `log`. Each at most once. |
| `screen` | when `screen` is in `channels.out` | The screen, see below. |
| `inputs` | no | Clickable parts, see below. |
| `servos` | when `servo` is in `channels.out` | Servo joints, see below. |
| `hostLink` | when `hostRx` or `hostTx` is used | The computer connection, see below. |
| `mic` | when `mic` is in `channels.in` | `{ sampleRate }`: the microphone rate the firmware expects (8000, 16000, 24000, 32000, 44100 or 48000). |

### `firmware`

| Field | Meaning |
|---|---|
| `version` | The firmware's own version string (as the upstream project names it). |
| `upstream` | `{ repo, commit }`: the firmware's source repository (`https://` URL) and the full 40-character commit it was built from. |
| `virtualDevice` | `{ repo, commit }`: the virtual device repository (device layer and build script) and its commit. A page's "source code" link comes from here. |
| `license` | `{ spdx, unofficial, note?, files? }`: the licence (SPDX id or the upstream licence's name), whether the build must be marked unofficial (not endorsed by the upstream author), an optional note `{ zh, en }` to show, and the licence files shipped in `licenses/` (*rule*: each must be in `files`). |

### `runtime`

| Field | Meaning |
|---|---|
| `interfaceVersion` | The virtual device interface version the firmware was built against: `3` (`vhw/include/vdev_io.h`). |
| `module` | Path of the firmware module in the package, `firmware/<name>.mjs` (*rule*: must be in `files`). |
| `memoryMB` | Memory the module reserves (16–4096). |
| `threads` | Threads it starts with (1–64). |
| `virtualTime` | `true` when built on the virtual clock (deterministic; `runUntil` works). |

### `files[]`

`{ path, size, sha256 }`: path under `firmware/` or `licenses/` (letters, digits, `.`, `_`, `-`, `/`; no `.` or `..` parts; each once), size in bytes, sha256 in lower-case hex. *Rule*: the package holds exactly these files plus `device.json`, with these sizes and hashes (`checkPackageFiles`).

### `screen`

| Field | Meaning |
|---|---|
| `node` | The node whose material shows the screen. |
| `materialIndex` | Which material of that node's mesh, when it has several (optional). |
| `panel` | `{ width, height, format }`: the panel in its native scan direction, as the interface's screen frames come (`format`: `rgb565`). |
| `rotateCW` | 0, 90, 180 or 270: how far the native picture turns clockwise to be the way people see it. |
| `area` | `{ x, y, width, height }`: where the turned picture sits in the material's texture space, as fractions (glTF texture coordinates: origin top-left, `v` going down). The picture fills it exactly; *rule*: inside 0..1, width and height above 0. |
| `background` | `#rrggbb` around the area (optional, black). |

A click on the screen node at texture coordinates `(u, v)` becomes a touch at the panel pixel `uvToPanel(screen, [u, v])` (`src/runtime/geometry.mjs`).

### `inputs[]`

Each is one clickable part; `kind` decides the rest. *Rule*: the input's channel must be in `channels.in`.

| `kind` | Fields | Meaning |
|---|---|---|
| `button` | `node`, `button`, `press?` | Clicking the node presses interface button number `button` (0–31) while held (at least 100 ms of device time). |
| `joystick` | `node`, `right`, `up`, `radiusMm`, `button?`, `press?` | Clicking or dragging on the cap pushes the stick: the hit point relative to the node's centre, along `right` and `up` (Kit model directions), divided by `radiusMm`, gives x and y in -1..1. With `button`, a click near the centre presses that button (needs the `button` channel). |
| `touch` | `node` | Touch screen. *Rule*: `node` is `screen.node`. |

`press: { offsetMm: [x, y, z] }` moves the node by that much while pressed (visible feedback).

### `servos[]`

| Field | Meaning |
|---|---|
| `id` | Interface servo number (0–31, each once). |
| `nodes` | The nodes this servo turns (at least one). |
| `pivot` | The point the axis goes through: `[x, y, z]` in Kit model coordinates, or `{ node }` = that node's bounding-box centre in the Kit model. |
| `axis` | Axis direction `[x, y, z]` (not zero); positive angles turn by the right-hand rule. |
| `zeroDeg` | The servo angle at which the nodes are where the Kit model has them. |
| `direction` | `1` or `-1`. |
| `scale` | Joint degrees per servo degree (gears, partial travel). |
| `minDeg`, `maxDeg` | Optional limits of the joint angle. |
| `approximate` | Optional `{ zh, en }` note when the mapping is an approximation of the real device (shown or kept as a record). |

Joint angle = `direction × scale × (servo angle − zeroDeg)`, clamped to the limits.

### `hostLink`

| Field | Meaning |
|---|---|
| `port` | The local port the computer-side program listens on (1024–65535). The page connects to `ws://127.0.0.1:<port><path>`. |
| `path` | WebSocket path, starting with `/`. |
| `protocol` | Name of the byte protocol between device and program (for people: `DBOT v1`, `JSON Lines`). Bytes are forwarded exactly as they are; the runtime does not interpret them. |

*Rule*: a `hostLink` needs both `hostRx` and `hostTx`.

## Using the validator

```js
import { validateDeviceDescription, checkPackageFiles, checkNodesInModel, glbNodeNames, referencedNodes } from 'esp32-virtual-hardware/device-description';

const { ok, issues } = validateDeviceDescription(description);   // structure and rules
const fileIssues = await checkPackageFiles(description, files);   // files: Map<path, Uint8Array> from readPackage()
const nodeIssues = checkNodesInModel(description, glbNodeNames(kitGlbBytes));
```

Every function returns all problems at once as `{ path, rule, message }` (English message; `rule` is a stable code to translate): `required`, `type`, `unknown_field`, `enum`, `format`, `range`, `empty`, `duplicate`, `unsupported_version`, `bad_path`, `not_in_files`, `channel_not_declared`, `not_screen_node`, `zero_vector`, `file_missing`, `file_unlisted`, `size_mismatch`, `sha256_mismatch`, `package_too_large`, `unknown_node`.

What the validator cannot know is the shop's business: whether `appliesTo.kit` is the Kit being uploaded to, whether the Options belong to it and change hardware, whether the Kit has a Kit model. The shop's checker adds those.
