import {
    CPU,
    NullProbe,
    ProbeAll,
    SampledAudioSink,
    TrapCondition
} from "./devices";
import {EmuHalt} from "./error";
import {KeyFlags} from "./keys";

export class ZXWASMMachine {
    prefix: string;
    instance: WebAssembly.Instance;
    exports: any;
    sys: number;
    pixel_dest: Uint32Array;
    pixel_src: Uint32Array;
    stateptr: number;
    statearr: Uint8Array;
    cpustateptr: number;
    cpustatearr: Uint8Array;
    ctrlstateptr: number;
    ctrlstatearr: Uint8Array;
    cpu: CPU;
    romptr: number;
    romlen: number;
    romarr: Uint8Array;
    biosptr: number;
    biosarr: Uint8Array;
    audio: SampledAudioSink;
    audioarr: Float32Array;
    probe: ProbeAll;
    maxROMSize: number = 0x40000;

    numTotalScanlines = 312;
    cpuCyclesPerLine = 224;

    joymask0 = 0;

    constructor() {
        this.prefix = 'zx';
        var self = this;
        this.cpu = {
            getPC: self.getPC.bind(self),
            getSP: self.getSP.bind(self),
            isStable: self.isStable.bind(self),
            reset: self.reset.bind(self),
            saveState: () => {
                return self.getCPUState();
            },
            loadState: () => {
                console.log("loadState not implemented")
            },
            connectMemoryBus() {
                console.log("connectMemoryBus not implemented")
            },
        }
    }

    async fetchWASM() {
        var wasmResponse = await fetch('wasm/zx.wasm');
        if (wasmResponse.status == 200 || (wasmResponse as any as Blob).size) {
            var wasmBinary = await wasmResponse.arrayBuffer();
            var wasmCompiled = await WebAssembly.compile(wasmBinary);
            var wasmResult = await WebAssembly.instantiate(wasmCompiled, {});
            this.instance = wasmResult;
            this.exports = wasmResult.exports;
        } else {
            throw new Error('could not load WASM file');
        }
    }

    async fetchBIOS() {
        var biosResponse = await fetch('roms/opense.rom');
        if (biosResponse.status == 200 || (biosResponse as any as Blob).size) {
            var biosBinary = await biosResponse.arrayBuffer();
            this.biosptr = this.exports.malloc(biosBinary.byteLength);
            this.biosarr = new Uint8Array(this.exports.memory.buffer, this.biosptr, biosBinary.byteLength);
            this.loadBIOS(new Uint8Array(biosBinary));
        } else {
            throw new Error('could not load BIOS file');
        }
    }

    async initWASM() {

        // init machine instance
        this.sys = this.exports.machine_init(this.biosptr);
        let statesize = this.exports.machine_get_state_size();
        this.stateptr = this.exports.malloc(statesize);
        let ctrlstatesize = this.exports.machine_get_controls_state_size();
        this.ctrlstateptr = this.exports.malloc(ctrlstatesize);
        let cpustatesize = this.exports.machine_get_cpu_state_size();
        this.cpustateptr = this.exports.malloc(cpustatesize);
        this.romptr = this.exports.malloc(this.maxROMSize);

        // create state buffers
        // must do this after allocating memory (and everytime we grow memory?)
        this.statearr = new Uint8Array(this.exports.memory.buffer, this.stateptr, statesize);
        this.ctrlstatearr = new Uint8Array(this.exports.memory.buffer, this.ctrlstateptr, ctrlstatesize);
        this.cpustatearr = new Uint8Array(this.exports.memory.buffer, this.cpustateptr, cpustatesize);

        // create audio buffer
        let sampbufsize = 4096 * 4;
        this.audioarr = new Float32Array(this.exports.memory.buffer, this.exports.machine_get_sample_buffer(), sampbufsize);

        // create ROM buffer
        this.romarr = new Uint8Array(this.exports.memory.buffer, this.romptr, this.maxROMSize);

        console.log('machine_init', this.sys, statesize, ctrlstatesize, cpustatesize, sampbufsize);
    }

    async loadWASM() {
        await this.fetchWASM();
        this.exports.memory.grow(96);
        await this.fetchBIOS();
        await this.initWASM();
    }

    getPC(): number {
        return this.exports.machine_cpu_get_pc(this.sys);
    }

    getSP(): number {
        return this.exports.machine_cpu_get_sp(this.sys);
    }

    isStable(): boolean {
        return this.exports.machine_cpu_is_stable(this.sys);
    }

    loadROM(rom: Uint8Array) {
        if (rom.length > this.maxROMSize) {
            throw new EmuHalt(`Rom size too big: ${rom.length} bytes`);
        }

        this.romarr.set(rom);
        this.romlen = rom.length;
        console.log('load rom', rom.length, 'bytes');

        this.reset();
    }

    loadBIOS(srcArray: Uint8Array) {
        this.biosarr.set(srcArray);
    }

    read(address: number): number {
        return this.exports.machine_mem_read(this.sys, address & 0xffff);
    }

    readConst(address: number): number {
        return this.exports.machine_mem_read(this.sys, address & 0xffff);
    }

    write(address: number, value: number): void {
        this.exports.machine_mem_write(this.sys, address & 0xffff, value & 0xff);
    }

    getAudioParams() {
        return {sampleRate: 44100, stereo: false};
    }

    videoOffsetBytes = 0;

    connectVideo(pixels: Uint32Array): void {
        this.pixel_dest = pixels;
        var pixbuf = this.exports.machine_get_pixel_buffer(this.sys); // save video pointer
        console.log('connectVideo', pixbuf, pixels.length);
        this.pixel_src = new Uint32Array(this.exports.memory.buffer, pixbuf + this.videoOffsetBytes, pixels.length);
    }

    syncVideo() {
        if (this.exports.machine_update_video) {
            this.exports.machine_update_video(this.sys);
        }
        if (this.pixel_dest != null) {
            this.pixel_dest.set(this.pixel_src);
        }
    }

    // assume controls buffer is smaller than cpu buffer
    saveControlsState(): any {
        //console.log(1, this.romptr, this.romlen, this.ctrlstateptr, this.romarr.slice(0,4), this.ctrlstatearr.slice(0,4));
        this.exports.machine_save_controls_state(this.sys, this.ctrlstateptr);
        //console.log(2, this.romptr, this.romlen, this.ctrlstateptr, this.romarr.slice(0,4), this.ctrlstatearr.slice(0,4));
        return {controls: this.ctrlstatearr.slice(0)}
    }

    loadControlsState(state): void {
        this.ctrlstatearr.set(state.controls);
        this.exports.machine_load_controls_state(this.sys, this.ctrlstateptr);
    }

    connectAudio(audio: SampledAudioSink): void {
        this.audio = audio;
    }

    syncAudio() {
        if (this.audio != null) {
            var n = this.exports.machine_get_sample_count();
            for (var i = 0; i < n; i++) {
                this.audio.feedSample(this.audioarr[i], 1);
            }
        }
    }

    advanceFrameClock(trap, cpf: number): number {
        var i: number;

        if (trap) {
            for (i = 0; i < cpf; i++) {
                if (trap()) {
                    break;
                }
                this.exports.machine_tick(this.sys);
            }
        } else {
            this.exports.machine_exec(this.sys, cpf);
            i = cpf;
        }

        this.syncVideo();
        this.syncAudio();

        return i;
    }

    copyProbeData() {
        if (this.probe && !(this.probe instanceof NullProbe)) {
            var datalen = this.exports.machine_get_probe_buffer_size();
            var dataaddr = this.exports.machine_get_probe_buffer_address();
            var databuf = new Uint32Array(this.exports.memory.buffer, dataaddr, datalen);

            this.probe.logNewFrame();
            this.probe.addLogBuffer(databuf);
        }
    }

    connectProbe(probe: ProbeAll): void {
        this.probe = probe;
    }

    reset() {
        this.exports.machine_reset(this.sys);

        // advance bios
        this.exports.machine_exec(this.sys, 500000);

        // load rom (Z80 header: https://worldofspectrum.org/faq/reference/z80format.htm)
        if (this.romptr && this.romlen) {
            this.exports.machine_load_rom(this.sys, this.romptr, this.romlen);
        }

        // clear keyboard
        for (var ch = 0; ch < 128; ch++) {
            this.setKeyInput(ch, 0, KeyFlags.KeyUp);
        }
    }

    advanceFrame(trap: TrapCondition): number {
        var probing = this.probe != null;
        if (probing) this.exports.machine_reset_probe_buffer();
        var clocks = this.advanceFrameClock(trap, Math.floor(1000000 / 50));
        if (probing) this.copyProbeData();
        return clocks;
    }

    getCPUState() {
        this.exports.machine_save_cpu_state(this.sys, this.cpustateptr);

        var s = this.cpustatearr;

        var af = s[9] + (s[8] << 8); // not FA
        var hl = s[10] + (s[11] << 8);
        var de = s[12] + (s[13] << 8);
        var bc = s[14] + (s[15] << 8);
        var sp = s[24] + (s[25] << 8);
        var iy = s[26] + (s[27] << 8);
        var ix = s[28] + (s[29] << 8);
        var pc = s[34] + (s[35] << 8);
        var ir = s[36] + (s[37] << 8);

        return {
            PC: pc,
            SP: sp,
            AF: af,
            BC: bc,
            DE: de,
            HL: hl,
            IX: ix,
            IY: iy,
            IR: ir,
            o: this.readConst(pc),
        }
    }

    saveState() {
        this.exports.machine_save_state(this.sys, this.stateptr);

        return {
            c: this.getCPUState(),
            state: this.statearr.slice(0),
        };
    }

    loadState(state): void {
        this.statearr.set(state.state);
        this.exports.machine_load_state(this.sys, this.stateptr);
    }

    getVideoParams() {
        return {width: 320, height: 256, overscan: true, videoFrequency: 50};
    }

    setKeyInput(key: number, code: number, flags: number): void {

        if (key == 16 || key == 17 || key == 18 || key == 224) return; // meta keys

        //console.log(key, code, flags);

        var mask = 0;
        var mask2 = 0;

        if (key == 37) { key = 0x8; mask = 0x4; } // LEFT
        if (key == 38) { key = 0xb; mask = 0x1; } // UP
        if (key == 39) { key = 0x9; mask = 0x8; } // RIGHT
        if (key == 40) { key = 0xa; mask = 0x2; } // DOWN
        if (key == 32) { mask = 0x10; } // FIRE
        if (key == 65) { key = 65; mask2 = 0x4; } // LEFT
        if (key == 87) { key = 87; mask2 = 0x1; } // UP
        if (key == 68) { key = 68; mask2 = 0x8; } // RIGHT
        if (key == 83) { key = 83; mask2 = 0x2; } // DOWN
        if (key == 69) { mask2 = 0x10; } // FIRE
        if (key == 113) { key = 0xf1; } // F2
        if (key == 115) { key = 0xf3; } // F4
        if (key == 119) { key = 0xf5; } // F8
        if (key == 121) { key = 0xf7; } // F10

        if (flags & KeyFlags.KeyDown) {
            this.exports.machine_key_down(this.sys, key);
            this.joymask0 |= mask;
        } else if (flags & KeyFlags.KeyUp) {
            this.exports.machine_key_up(this.sys, key);
            this.joymask0 &= ~mask;
        }

        this.exports.zx_joystick(this.sys, this.joymask0, 0);
    }
}
