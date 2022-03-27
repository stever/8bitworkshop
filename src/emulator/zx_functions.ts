import {hex, printFlags} from "../util";
import {ZXWASMPlatform} from "./zx_platform";

export function cpuStateToLongString_Z80(c) {
    function decodeFlags(flags) {
        return printFlags(flags, ["S", "Z", "H", "V", "N", "C"], true);
    }

    return "PC " + hex(c.PC, 4) + "  " + decodeFlags(c.AF) + " " + (c.iff1 ? "I" : "-") + (c.iff2 ? "I" : "-") + "\n"
        + "SP " + hex(c.SP, 4) + "  IR " + hex(c.IR, 4) + "\n"
        + "IX " + hex(c.IX, 4) + "  IY " + hex(c.IY, 4) + "\n"
        + "AF " + hex(c.AF, 4) + "  BC " + hex(c.BC, 4) + "\n"
        + "DE " + hex(c.DE, 4) + "  HL " + hex(c.HL, 4) + "\n"
        ;
}

export function getToolForFilename_z80(fn: string): string {
    if (fn.endsWith(".c")) return "sdcc";
    if (fn.endsWith(".h")) return "sdcc";
    if (fn.endsWith(".s")) return "sdasz80";
    if (fn.endsWith(".ns")) return "naken";
    if (fn.endsWith(".scc")) return "sccz80";
    if (fn.endsWith(".z")) return "zmac";
    if (fn.endsWith(".wiz")) return "wiz";
    return "zmac";
}

export function dumpStackToString(platform: ZXWASMPlatform, mem: Uint8Array | number[], start: number, end: number, sp: number, jsrop: number): string {
    var s = "";
    var nraw = 0;

    function read(addr) {
        if (addr < mem.length) return mem[addr];
        else return platform.readAddress(addr);
    }

    while (sp < end) {
        sp++;

        // see if there's a JSR on the stack here
        var addr = read(sp) + read(sp + 1) * 256;
        var jsrofs = jsrop == 0x20 ? -2 : -3; // 6502 vs Z80
        var opcode = read(addr + jsrofs); // might be out of bounds
        if (opcode == jsrop) { // JSR
            s += "\n$" + hex(sp) + ": ";
            s += hex(addr, 4) + " " + lookupSymbol(platform, addr, true);
            sp++;
            nraw = 0;
        } else {
            if (nraw == 0)
                s += "\n$" + hex(sp) + ": ";
            s += hex(read(sp)) + " ";
            if (++nraw == 8) nraw = 0;
        }
    }

    return s + "\n";
}

export function lookupSymbol(platform: ZXWASMPlatform, addr: number, extra: boolean) {
    var start = addr;
    var addr2symbol = platform.debugSymbols && platform.debugSymbols.addr2symbol;

    while (addr2symbol && addr >= 0) {
        var sym = addr2symbol[addr];

        if (sym) { // return first symbol we find
            var sym = addr2symbol[addr];
            return extra ? (sym + " + $" + hex(start - addr)) : sym;
        }

        if (!extra) {
            break;
        }

        addr--;
    }

    return "";
}
