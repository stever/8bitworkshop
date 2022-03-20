import { ZX_WASMMachine } from "../machine/zx";
import { Platform, BaseZ80MachinePlatform } from "../machine/zx";
import { PLATFORMS } from "../common/emu";

const ZX_PRESETS = [
  {id:'hello.asm', name:'Hello World (ASM)'},
  {id:'bios.c', name:'BIOS Routines (C)'},
  {id:'cosmic.c', name:'Cosmic Impalas (C)'},
];

const ZX_MEMORY_MAP = { main:[
  {name:'BIOS', start:0x0000, size:0x4000, type:'rom'},
  {name:'Screen RAM', start:0x4000, size:0x1800, type:'ram'},
  {name:'Color RAM', start:0x5800, size:0x300, type:'ram'},
  {name:'System RAM', start:0x5c00, size:0xc0, type:'ram'},
  {name:'User RAM', start:0x5ccb, size:0xff58-0x5ccb, type:'ram'},
] }

// WASM ZX Spectrum platform
class ZXWASMPlatform extends BaseZ80MachinePlatform<ZX_WASMMachine> implements Platform {
  newMachine() { return new ZX_WASMMachine('zx'); }
  getPresets() { return ZX_PRESETS; }
  getDefaultExtension() { return ".asm"; };
  readAddress(a) { return this.machine.readConst(a); }
  getMemoryMap() { return ZX_MEMORY_MAP; }
  showHelp() { window.open("https://worldofspectrum.org/faq/reference/reference.htm", "_help"); }
}

PLATFORMS['zx'] = ZXWASMPlatform;
