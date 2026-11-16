## Rules

- Upstream firmware is built as it is, from the commit pinned in this repository. Never copy upstream source into this repository and never patch it; replace hardware at the lowest layer instead. When a whole upstream file cannot be used (it writes chip registers directly), replace it with a file of our own and list it with the reason in the README.
- Everything shared by more than one device belongs in `esp32-virtual-hardware`, not in a device repository.
- The only boundary between firmware and the outside world is the virtual device interface. Tests drive the firmware through it, in Node, without a browser.
- Public repository: no secrets, keys, customer data or internal Thorb links.
- Layout of the whole family: see `../README.md` of the local folder `thorb-virtual-devices` (repository `ThorbJ/thorb-virtual-devices`).
