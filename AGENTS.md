## Rules

- Upstream firmware is built as it is, from the commit pinned in this repository. Never copy upstream source into this repository and never patch it; replace hardware at the lowest layer instead. When a whole upstream file cannot be used (it writes chip registers directly), replace it with a file of our own and list it with the reason in the README.
- Everything shared by more than one device belongs in `esp32-virtual-hardware`, not in a device repository.
- The only boundary between firmware and the outside world is the virtual device interface. Tests drive the firmware through it, in Node, without a browser.
- Public repository: no secrets, keys, customer data or internal Thorb links.
- Layout of the whole family: see `../README.md` of the local folder `thorb-virtual-devices` (repository `ThorbJ/thorb-virtual-devices`).
- The interface layout lives twice, `vhw/include/vdev_io.h` and `src/interface/io-layout.mjs`: change both together, bump `VDEV_IO_VERSION` / `VERSION`, the description format's `INTERFACE_VERSION` and `schema.json`, and rebuild the test device.
- The device description format (`device-description/`) is a contract with the shop's checker: any field change is a new `formatVersion`, with `README.md`, `validate.mjs` and `schema.json` changed together (`tests/description-schema.test.mjs` keeps the last two in step).
- `fixtures/test-device/` is built, not edited: commit source changes first, then `node test-device/build.mjs` (it records the commit) and commit the fixture.
- Release: tag `vX.Y.Z` on `main`; users pin the tag's commit. New code and comments in English.
