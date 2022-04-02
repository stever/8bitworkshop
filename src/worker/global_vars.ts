import * as sdcc from "./sdcc";
import * as z80 from "./z80";

export const PLATFORM_PARAMS = {
    'zx': {
        arch: 'z80',
        code_start: 0x5ccb,
        rom_size: 0xff58 - 0x5ccb,
        data_start: 0xf000,
        data_size: 0xfe00 - 0xf000,
        stack_end: 0xff58,
        extra_link_args: ['crt0-zx.rel'],
        extra_link_files: ['crt0-zx.rel', 'crt0-zx.lst'],
    },
};

export const TOOLS = {
    'sdasz80': sdcc.assembleSDASZ80,
    'sdldz80': sdcc.linkSDLDZ80,
    'sdcc': sdcc.compileSDCC,
    'zmac': z80.assembleZMAC,
}

export const TOOL_PRELOADFS = {
    'sdasz80': 'sdcc',
    'sdcc': 'sdcc',
}
