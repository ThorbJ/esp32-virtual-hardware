# esp32-virtual-hardware

Run unmodified ESP32 firmware in the browser.

The firmware's own source (ESP-IDF or Arduino-ESP32) is compiled to WebAssembly as it is. Only the lowest layer, the code that drives the chip's peripherals, is replaced by virtual hardware. A web page then shows the device on its 3D model: the screen is drawn on the model's screen, clicks on the model's buttons, joystick and touch screen become real inputs, servos turn the model's parts, and the speaker, microphone and camera are the computer's. Where the real device talks to a program on a computer over USB, the virtual one talks to the same program over a local WebSocket.

This repository holds what every device shares. Each device has its own repository with its device-specific layer and build, for example [brufik-virtual](https://github.com/ThorbJ/brufik-virtual) and [hachimodock-virtual](https://github.com/ThorbJ/hachimodock-virtual).

中文：让 ESP32 的真固件原样在浏览器里运行。固件源码直接编译成 WebAssembly，只把操作芯片外设的最底层换成虚拟硬件；本仓库是所有设备共用的那一层。

## What is in it

- **Virtual device interface**: the one boundary between the firmware and the outside world, the same in the browser and in Node (for tests). In: buttons, joystick, touch, microphone frames, camera frames, bytes from the computer. Out: screen frames, servo angles, speaker frames, bytes to the computer, logs. Lifecycle: power on, power off.
- **Virtual hardware**: FreeRTOS on WebAssembly threads with a virtual clock (deterministic runs), NVS in memory, timers, random numbers, a fixed virtual MAC, GPIO, LEDC, I2S and audio codecs, SPI with screen controller models, `esp_lcd` panel capture, USB CDC / UART byte streams, and an Arduino-ESP32 layer.
- **Page runtime**: screen texture on the 3D model, picking of buttons and the touch screen, servo joints, speaker and microphone through WebAudio, camera through `getUserMedia`, and the link to the computer-side program.

## Status

Being moved here from Thorb's working experiment, where it runs Brufik and HachimoDock end to end in desktop Chrome.

## License

MIT. A device build that links this code with firmware under another license (GPL-3.0, for example) is covered by that license as a whole.
