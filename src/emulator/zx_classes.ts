import {invertMap} from "../util";
import {
    AddrSymbolMap,
    BreakpointCallback,
    DebugCondition,
    DebugEvalCondition,
    DisasmLine,
    SymbolMap
} from "./zx_types";
import {FileData} from "../worker/types";
import {AnimationTimer, RasterVideo} from "./video";
import {SampledAudio} from "./audio";
import {ControllerPoller} from "./joystick";
import {
    CPU,
    NullProbe,
    ProbeAll,
    SampledAudioSink,
    TrapCondition
} from "./devices";
import {ProbeRecorder} from "./recorder";
import {EmuHalt} from "./error";
import {KeyFlags} from "./keys";
import {
    Breakpoint,
    CpuState,
    EmuRecorder,
    EmuState
} from "./zx_interfaces";
import {
    cpuStateToLongString_Z80,
    dumpStackToString,
    getToolForFilename_z80,
    inspectSymbol,
    isDebuggable
} from "./zx_functions";
import {disassemble} from "./disassemble";
import {ZX_MEMORY_MAP, ZX_PRESETS} from "./zx";

export class DebugSymbols {
    symbolmap: SymbolMap;	// symbol -> address
    addr2symbol: AddrSymbolMap;	// address -> symbol
    debuginfo: {}; // extra platform-specific debug info

    constructor(symbolmap: SymbolMap, debuginfo: {}) {
        this.symbolmap = symbolmap;
        this.debuginfo = debuginfo;
        this.addr2symbol = invertMap(symbolmap);
        if (!this.addr2symbol[0x0]) this.addr2symbol[0x0] = '$00'; // needed for ...
        this.addr2symbol[0x10000] = '__END__'; // ... dump memory to work
    }
}

// for composite breakpoints w/ single debug function
export class BreakpointList {
    id2bp: { [id: string]: Breakpoint } = {};

    getDebugCondition(): DebugCondition {
        if (Object.keys(this.id2bp).length == 0) {
            return null; // no breakpoints
        } else {
            // evaluate all breakpoints
            return () => {
                var result = false;
                for (var id in this.id2bp)
                    if (this.id2bp[id].cond())
                        result = true;
                return result;
            };
        }
    }
}

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

    constructor(prefix: string) {
        this.prefix = prefix;
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
        if (rom.length > this.maxROMSize) throw new EmuHalt(`Rom size too big: ${rom.length} bytes`);
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

    numTotalScanlines = 312;
    cpuCyclesPerLine = 224;

    joymask0 = 0;

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

export class ZXWASMPlatform {
    recorder: EmuRecorder = null;
    debugSymbols: DebugSymbols;
    internalFiles: { [path: string]: FileData } = {};

    onBreakpointHit: BreakpointCallback;
    debugCallback: DebugCondition;

    debugSavedState: EmuState = null;
    debugBreakState: EmuState = null;
    debugTargetClock: number = 0;
    debugClock: number = 0;
    breakpoints: BreakpointList = new BreakpointList();
    frameCount: number = 0;

    machine: ZXWASMMachine;
    mainElement: HTMLElement;
    timer: AnimationTimer;
    video: RasterVideo;
    audio: SampledAudio;
    poller: ControllerPoller;

    probeRecorder: ProbeRecorder;
    startProbing;
    stopProbing;

    constructor(mainElement: HTMLElement) {
        this.mainElement = mainElement;
    }

    setRecorder(recorder: EmuRecorder): void {
        this.recorder = recorder;
    }

    updateRecorder() {
        // are we recording and do we need to save a frame?
        if (this.recorder && this.isRunning() && this.recorder.frameRequested()) {
            this.recorder.recordFrame(this.saveState());
        }
    }

    inspect(sym: string): string {
        return inspectSymbol(this, sym);
    }

    getDebugTree(): {} {
        return this.saveState();
    }

    readFile(path: string): FileData {
        return this.internalFiles[path];
    }

    writeFile(path: string, data: FileData): boolean {
        this.internalFiles[path] = data;
        return true;
    }

    setBreakpoint(id: string, cond: DebugCondition) {
        if (cond) {
            this.breakpoints.id2bp[id] = {cond: cond};
            this.restartDebugging();
        } else {
            this.clearBreakpoint(id);
        }
    }

    clearBreakpoint(id: string) {
        delete this.breakpoints.id2bp[id];
    }

    getDebugCallback(): DebugCondition {
        return this.breakpoints.getDebugCondition();
    }

    setupDebug(callback: BreakpointCallback): void {
        this.onBreakpointHit = callback;
    }

    clearDebug() {
        this.debugSavedState = null;
        this.debugBreakState = null;
        this.debugTargetClock = -1;
        this.debugClock = 0;
        this.onBreakpointHit = null;
        this.clearBreakpoint('debug');
        this.frameCount = 0;
    }

    setDebugCondition(debugCond: DebugCondition) {
        this.setBreakpoint('debug', debugCond);
    }

    restartDebugging() {
        if (this.debugSavedState) {
            this.loadState(this.debugSavedState);
        } else {
            this.debugSavedState = this.saveState();
        }

        this.debugClock = 0;
        this.debugCallback = this.getDebugCallback();
        this.debugBreakState = null;
        this.resume();
    }

    preFrame() {
        // save state before frame, to record any inputs that happened pre-frame
        if (this.debugCallback && !this.debugBreakState) {

            // save state every frame and rewind debug clocks
            this.debugSavedState = this.saveState();
            this.debugTargetClock -= this.debugClock;
            this.debugClock = 0;
        }
    }

    postFrame() {
        // reload debug state at end of frame after breakpoint
        if (this.debugCallback && this.debugBreakState) {
            this.loadState(this.debugBreakState);
        }

        this.frameCount++;
    }

    nextFrame(novideo: boolean): number {
        this.pollControls();
        this.updateRecorder();
        this.preFrame();
        var steps = this.advance(novideo);
        this.postFrame();
        return steps;
    }

    breakpointHit(targetClock: number, reason?: string) {
        console.log(this.debugTargetClock, targetClock, this.debugClock, this.isStable());
        this.debugTargetClock = targetClock;
        this.debugBreakState = this.saveState();
        console.log("Breakpoint at clk", this.debugClock, "PC", this.debugBreakState.c.PC.toString(16));

        this.pause();

        if (this.onBreakpointHit) {
            this.onBreakpointHit(this.debugBreakState, reason);
        }
    }

    runEval(evalfunc: DebugEvalCondition) {
        this.setDebugCondition(() => {
            if (++this.debugClock >= this.debugTargetClock && this.isStable()) {
                var cpuState = this.getCPUState();

                if (evalfunc(cpuState)) {
                    this.breakpointHit(this.debugClock);
                    return true;
                } else {
                    return false;
                }
            }
        });
    }

    runToPC(pc: number) {
        this.debugTargetClock++;

        this.runEval((c) => {
            return c.PC == pc;
        });
    }

    runUntilReturn() {
        var SP0 = this.getSP();

        this.runEval((c: CpuState): boolean => {
            return c.SP > SP0;
        });
    }

    runToFrameClock(clock: number): void {
        this.restartDebugging();
        this.debugTargetClock = clock;

        this.runEval((): boolean => {
            return true;
        });
    }

    step() {
        this.runToFrameClock(this.debugClock + 1);
    }

    stepBack() {
        var prevState;
        var prevClock;
        var clock0 = this.debugTargetClock;
        this.restartDebugging();
        this.debugTargetClock = clock0 - 25;

        this.runEval((c: CpuState): boolean => {
            if (this.debugClock < clock0) {
                prevState = this.saveState();
                prevClock = this.debugClock;
                return false;
            } else {
                if (prevState) {
                    this.loadState(prevState);
                    this.debugClock = prevClock;
                }

                return true;
            }
        });
    }

    reset() {
        this.machine.reset();
    }

    loadState(s) {
        this.machine.loadState(s);
    }

    saveState() {
        return this.machine.saveState();
    }

    getSP() {
        return this.machine.cpu.getSP();
    }

    isStable() {
        return this.machine.cpu.isStable();
    }

    getCPUState() {
        return this.machine.cpu.saveState();
    }

    loadControlsState(s) {
        this.machine.loadControlsState(s);
    }

    saveControlsState() {
        return this.machine.saveControlsState();
    }

    async start() {
        this.machine = this.newMachine();
        const m = this.machine;

        // block on WASM loading
        if (m instanceof ZXWASMMachine) {
            await m.loadWASM();
        }

        var videoFrequency;
        var vp = m.getVideoParams();

        this.video = new RasterVideo(this.mainElement, vp.width, vp.height, {overscan: !!vp.overscan});
        this.video.create();

        m.connectVideo(this.video.getFrameData());

        this.video.setKeyboardEvents(m.setKeyInput.bind(m));
        this.poller = new ControllerPoller(m.setKeyInput.bind(m));

        videoFrequency = vp.videoFrequency;

        this.timer = new AnimationTimer(videoFrequency || 60, this.nextFrame.bind(this));

        var ap = m.getAudioParams();
        this.audio = new SampledAudio(ap.sampleRate);
        this.audio.start();
        m.connectAudio(this.audio);

        this.probeRecorder = new ProbeRecorder(m);

        this.startProbing = () => {
            m.connectProbe(this.probeRecorder);
            return this.probeRecorder;
        };

        this.stopProbing = () => {
            m.connectProbe(null);
        };

        this.loadBIOS = (data) => {
            m.loadBIOS(data);
        };
    }

    loadROM(title, data) {
        this.machine.loadROM(data);
        this.reset();
    }

    loadBIOS: (data) => void; // only set if hasBIOS() is true

    pollControls() {
        this.poller && this.poller.poll();
        if (this.machine['pollControls']) {
            this.machine['pollControls']();
        }
    }

    advance(novideo: boolean) {
        var steps = this.machine.advanceFrame(this.getDebugCallback());

        if (!novideo && this.video) {
            this.video.updateFrame();
        }

        return steps;
    }

    advanceFrameClock(trap, step) {
        if (!(step > 0)) {
            return;
        }

        return this.machine.advanceFrameClock(trap, step);
    }

    isRunning() {
        return this.timer && this.timer.isRunning();
    }

    resume() {
        this.timer.start();
        this.audio && this.audio.start();
    }

    pause() {
        this.timer.stop();
        this.audio && this.audio.stop();

        if (this.probeRecorder) {
            this.probeRecorder.singleFrame = true;
        }
    }

    runToVsync() {
        if (this.probeRecorder) {
            this.probeRecorder.clear();
            this.probeRecorder.singleFrame = false;
        }

        this.restartDebugging();

        var frame0 = this.frameCount;

        this.runEval((): boolean => {
            return this.frameCount > frame0;
        });
    }

    getToolForFilename = getToolForFilename_z80;

    getDebugCategories() {
        if (isDebuggable(this.machine)) {
            return this.machine.getDebugCategories();
        } else {
            return ['CPU', 'Stack'];
        }
    }

    getDebugInfo(category: string, state: EmuState): string {
        switch (category) {
            case 'CPU':
                return cpuStateToLongString_Z80(state.c);
            case 'Stack': {
                var sp = (state.c.SP - 1) & 0xffff;
                var start = sp & 0xff00;
                var end = start + 0xff;
                if (sp == 0) sp = 0x10000;
                console.log(sp, start, end);
                return dumpStackToString(this, [], start, end, sp, 0xcd);
            }
            default:
                return isDebuggable(this.machine) && this.machine.getDebugInfo(category, state);
        }
    }

    disassemble(pc: number, read: (addr: number) => number): DisasmLine {
        return disassemble(pc, read(pc), read(pc + 1), read(pc + 2), read(pc + 3));
    }

    newMachine() {
        return new ZXWASMMachine('zx');
    }

    getPresets() {
        return ZX_PRESETS;
    }

    readAddress(a) {
        return this.machine.readConst(a);
    }

    getMemoryMap() {
        return ZX_MEMORY_MAP;
    }

    showHelp() {
        window.open("https://worldofspectrum.org/faq/reference/reference.htm", "_help");
    }
}
