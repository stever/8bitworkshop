import {invertMap} from "../util";

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

export type DisasmLine = {
    line: string,
    nbytes: number,
    isaddr: boolean
};

export type SymbolMap = { [ident: string]: number };
export type AddrSymbolMap = { [address: number]: string };

export type DebugCondition = () => boolean;
export type DebugEvalCondition = (c: CpuState) => boolean;
export type BreakpointCallback = (s: EmuState, msg?: string) => void;

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
