import {FileData} from "../worker/types";
import {ProbeRecorder} from "./recorder";
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
    o?: number; // opcode
    SP?: number
}

export interface EmuState {
    c?: CpuState, // CPU state
    b?: Uint8Array | number[], // RAM
    ram?: Uint8Array,
}

export interface EmuControlsState {

}

export interface Debuggable {
    getDebugCategories?(): string[];

    getDebugInfo?(category: string, state: EmuState): string;
}

export interface Preset {
    id: string;
    name: string;
    chapter?: number;
    title?: string;
}

export interface Breakpoint {
    cond: DebugCondition;
}

export interface EmuRecorder {
    frameRequested(): boolean;

    recordFrame(state: EmuState);
}
