// Every channel of the virtual device interface. Device independent; each device description says which ones it uses.
// in = outside world → firmware; out = firmware → outside world.
export const INPUT_CHANNELS = Object.freeze({
  button: 'buttons: number + pressed / released',
  joystick: 'joystick: x and y in -1..1',
  touch: 'touch: panel coordinates + down / move / up',
  mic: 'microphone frames (16-bit PCM at the firmware rate)',
  camera: 'camera frames: given when the firmware asks, at its size and format (JPEG)',
  hostRx: 'byte stream computer → device (USB serial)',
  hostPresent: 'whether the computer is there (USB plugged in, the program has the port open)',
});

export const OUTPUT_CHANNELS = Object.freeze({
  screen: 'screen frames: width, height, pixel format, pixels',
  servo: 'servo angles: number, angle, time',
  speaker: 'speaker frames (16-bit PCM)',
  hostTx: 'byte stream device → computer',
  log: 'device log (serial print)',
});

export const LIFECYCLE = Object.freeze({
  powerOn: 'power on: load and start the firmware',
  powerOff: 'power off: stop and release',
});
