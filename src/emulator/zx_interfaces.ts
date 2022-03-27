import {FileData} from "../worker/types";
import {ProbeRecorder} from "./recorder";
import {
    AcceptsROM,
    Bus,
    FrameBased,
    HasCPU,
    Resettable, SavesInputState,
    SavesState
} from "./devices";
import {
    BreakpointCallback,
    DebugCondition,
    DebugEvalCondition,
    DisasmLine, MemoryMap
} from "./zx_types";
import {DebugSymbols} from "./zx_classes";

export interface OpcodeMetadata {
    minCycles: number;
    maxCycles: number;
    insnlength: number;
    opcode: number;
}

export interface CpuState {
    PC: number;
    EPC?: number; // effective PC (for bankswitching)
    o?: number;/*opcode*/
    SP?: number
    /*
    A:number, X:number, Y:number, SP:number, R:boolean,
    N,V,D,Z,C:boolean*/
}

export interface EmuState {
    c?: CpuState,	// CPU state
    b?: Uint8Array | number[], 	// RAM
    ram?: Uint8Array,
}

export interface EmuControlsState {

}

export interface Debuggable {
    getDebugCategories?(): string[];

    getDebugInfo?(category: string, state: EmuState): string;
}

export interface Platform {
    start(): void | Promise<void>;

    reset(): void;

    isRunning(): boolean;

    getToolForFilename(s: string): string;

    getDefaultExtension(): string;

    getPresets?(): Preset[];

    pause(): void;

    resume(): void;

    loadROM(title: string, rom: any);

    loadBIOS(rom: Uint8Array);

    getROMExtension?(rom: FileData): string;

    loadState?(state: EmuState): void;

    saveState?(): EmuState;

    loadControlsState?(state: EmuControlsState): void;

    saveControlsState?(): EmuControlsState;

    inspect?(ident: string): string;

    disassemble?(addr: number, readfn: (addr: number) => number): DisasmLine;

    readAddress?(addr: number): number;

    setFrameRate?(fps: number): void;

    getFrameRate?(): number;

    setupDebug?(callback: BreakpointCallback): void;

    clearDebug?(): void;

    step?(): void;

    runToVsync?(): void;

    runToPC?(pc: number): void;

    runUntilReturn?(): void;

    stepBack?(): void;

    runEval?(evalfunc: DebugEvalCondition): void;

    runToFrameClock?(clock: number): void;

    stepOver?(): void;

    restartAtPC?(pc: number): boolean;

    getOpcodeMetadata?(opcode: number, offset: number): OpcodeMetadata;

    getSP?(): number;

    getPC?(): number;

    getOriginPC?(): number;

    getPlatformName?(): string;

    getMemoryMap?(): MemoryMap;

    setRecorder?(recorder: EmuRecorder): void;

    advance?(novideo?: boolean): number;

    advanceFrameClock?(trap: DebugCondition, step: number): number;

    showHelp?(tool: string, ident?: string): void;

    resize?(): void;

    getRasterScanline?(): number;

    setBreakpoint?(id: string, cond: DebugCondition);

    clearBreakpoint?(id: string);

    hasBreakpoint?(id: string): boolean;

    getCPUState?(): CpuState;

    debugSymbols?: DebugSymbols;

    getDebugTree?(): {};

    startProbing?(): ProbeRecorder;

    stopProbing?(): void;

    isBlocked?(): boolean; // is blocked, halted, or waiting for input?

    readFile?(path: string): FileData;

    writeFile?(path: string, data: FileData): boolean;

    sourceFileFetch?: (path: string) => FileData;

    getDownloadFile?(): { extension: string, blob: Blob };
}

export interface Preset {
    id: string;
    name: string;
    chapter?: number;
    title?: string;
}

export interface MemoryBus {
    read: (address: number) => number;
    write: (address: number, value: number) => void;
    contend?: (address: number, cycles: number) => number;
    isContended?: (address: number) => boolean;
}

export interface Breakpoint {
    cond: DebugCondition;
}

export interface EmuRecorder {
    frameRequested(): boolean;

    recordFrame(state: EmuState);
}
