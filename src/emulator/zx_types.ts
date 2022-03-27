import {CpuState, EmuState} from "./zx_interfaces";

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
