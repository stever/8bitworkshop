import {CpuState, EmuRecorder, EmuState} from "./debug";
import {BreakpointList, DebugSymbols} from "./debug";
import {FileData} from "../worker/types";
import {
    BreakpointCallback,
    DebugCondition,
    DebugEvalCondition,
    DisasmLine
} from "./debug";
import {AnimationTimer, RasterVideo} from "./video";
import {SampledAudio} from "./audio";
import {ControllerPoller} from "./joystick";
import {ProbeRecorder} from "./recorder";
import {
    cpuStateToLongString_Z80, dumpStackToString,
    getToolForFilename_z80,
    inspectSymbol,
    isDebuggable
} from "./zx_functions";
import {ZXWASMMachine} from "./zx_machine";
import {disassemble} from "./disassemble";

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
        return new ZXWASMMachine();
    }

    getPresets() {
        return [
            {id: 'hello.asm', name: 'Hello World (ASM)'},
            {id: 'bios.c', name: 'BIOS Routines (C)'},
            {id: 'cosmic.c', name: 'Cosmic Impalas (C)'},
        ];
    }

    readAddress(a) {
        return this.machine.readConst(a);
    }

    getMemoryMap() {
        return {
            main: [
                {name: 'BIOS', start: 0x0000, size: 0x4000, type: 'rom'},
                {name: 'Screen RAM', start: 0x4000, size: 0x1800, type: 'ram'},
                {name: 'Color RAM', start: 0x5800, size: 0x300, type: 'ram'},
                {name: 'System RAM', start: 0x5c00, size: 0xc0, type: 'ram'},
                {name: 'User RAM', start: 0x5ccb, size: 0xff58 - 0x5ccb, type: 'ram'},
            ]
        };
    }

    showHelp() {
        window.open("https://worldofspectrum.org/faq/reference/reference.htm", "_help");
    }
}
