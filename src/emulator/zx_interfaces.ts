import {DebugCondition} from "./zx_types";

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
