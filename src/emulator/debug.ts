import {AddrSymbolMap, DebugCondition, SymbolMap} from "./zx_types";
import {invertMap} from "../util";
import {Breakpoint} from "./zx_interfaces";

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
