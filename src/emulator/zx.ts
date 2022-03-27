export const ZX_PRESETS = [
    {id: 'hello.asm', name: 'Hello World (ASM)'},
    {id: 'bios.c', name: 'BIOS Routines (C)'},
    {id: 'cosmic.c', name: 'Cosmic Impalas (C)'},
];

export const ZX_MEMORY_MAP = {
    main: [
        {name: 'BIOS', start: 0x0000, size: 0x4000, type: 'rom'},
        {name: 'Screen RAM', start: 0x4000, size: 0x1800, type: 'ram'},
        {name: 'Color RAM', start: 0x5800, size: 0x300, type: 'ram'},
        {name: 'System RAM', start: 0x5c00, size: 0xc0, type: 'ram'},
        {name: 'User RAM', start: 0x5ccb, size: 0xff58 - 0x5ccb, type: 'ram'},
    ]
}
