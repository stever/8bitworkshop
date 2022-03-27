import {platform} from "../ui";
import {hex, lpad, rpad} from "../util";
import {VirtualList} from "./vlist";
import {ProbeFlags, ProbeRecorder} from "../emulator/recorder";
import {BaseZ80MachinePlatform, BaseZ80Platform} from "../emulator/zx";

// TODO: https://stackoverflow.com/questions/10463518/converting-em-to-px-in-javascript-and-getting-default-font-size
export function getVisibleEditorLineHeight(): number {
    return $("#booksMenuButton").first().height();
}

export interface VirtualTextLine {
    text: string;
    clas?: string;
}

export class VirtualTextScroller {
    memorylist;
    maindiv: HTMLElement;

    getLineAt: (row: number) => VirtualTextLine;

    constructor(parent: HTMLElement) {
        var div = document.createElement('div');
        div.setAttribute("class", "memdump");
        parent.appendChild(div);
        this.maindiv = div;
    }

    create(workspace: HTMLElement, maxRowCount: number, fn: (row: number) => VirtualTextLine) {
        this.getLineAt = fn;

        this.memorylist = new VirtualList({
            w: $(workspace).width(),
            h: $(workspace).height(),
            itemHeight: getVisibleEditorLineHeight(),
            totalRows: maxRowCount,
            generatorFn: (row: number) => {
                var line = fn(row);
                var linediv = document.createElement("div");
                linediv.appendChild(document.createTextNode(line.text));
                if (line.clas != null) linediv.className = line.clas;
                return linediv;
            }
        });

        $(this.maindiv).append(this.memorylist.container);
    }

    refresh() {
        if (this.memorylist) {
            $(this.maindiv).find('[data-index]').each((i, e) => {
                var div = e;
                var row = parseInt(div.getAttribute('data-index'));
                var oldtext = div.innerText;
                var line = this.getLineAt(row);
                var newtext = line.text;

                if (oldtext != newtext) {
                    div.innerText = newtext;
                    if (line.clas != null && !div.classList.contains(line.clas)) {
                        var oldclasses = Array.from(div.classList);
                        oldclasses.forEach((c) => div.classList.remove(c));
                        div.classList.add('vrow');
                        div.classList.add(line.clas);
                    }
                }
            });
        }
    }
}

export function ignoreSymbol(sym: string) {
    return sym.endsWith('_SIZE__')
        || sym.endsWith('_LAST__')
        || sym.endsWith('STACKSIZE__')
        || sym.endsWith('FILEOFFS__')
        || sym.startsWith('l__')
        || sym.startsWith('s__')
        || sym.startsWith('.__.');
}

export abstract class ProbeViewBaseBase {
    probe: ProbeRecorder;
    tooldiv: HTMLElement;
    cumulativeData: boolean = false;
    cyclesPerLine: number;
    totalScanlines: number;

    abstract tick(): void;

    constructor() {
        var width = 160;
        var height = 262;

        try {
            width = Math.ceil(platform['machine']['cpuCyclesPerLine']) || width;
            height = Math.ceil(platform['machine']['numTotalScanlines']) || height;
        } catch (e) {
            console.error(e);
        }

        this.cyclesPerLine = width;
        this.totalScanlines = height;
    }

    addr2symbol(addr: number): string {
        var _addr2sym = (platform.debugSymbols && platform.debugSymbols.addr2symbol) || {};
        return _addr2sym[addr];
    }

    addr2str(addr: number): string {
        var sym = this.addr2symbol(addr);
        if (typeof sym === 'string') {
            return '$' + hex(addr) + ' (' + sym + ')';
        } else {
            return '$' + hex(addr);
        }
    }

    showTooltip(s: string) {
        if (s) {
            if (!this.tooldiv) {
                this.tooldiv = document.createElement("div");
                this.tooldiv.setAttribute("class", "tooltiptrack");
                document.body.appendChild(this.tooldiv);
            }

            $(this.tooldiv).text(s).show();
        } else {
            $(this.tooldiv).hide();
        }
    }

    setVisible(showing: boolean): void {
        if (showing) {
            this.probe = platform.startProbing();
            this.probe.singleFrame = !this.cumulativeData;
            this.tick();
        } else {
            if (this.probe) {
                this.probe.singleFrame = true;
            }

            platform.stopProbing();
            this.probe = null;
        }
    }

    redraw(eventfn: (op, addr, col, row, clk, value) => void) {
        var p = this.probe;

        if (!p || !p.idx) {
            return; // if no probe, or if empty
        }

        var row = 0;
        var col = 0;
        var clk = 0;

        for (var i = 0; i < p.idx; i++) {
            var word = p.buf[i];
            var addr = word & 0xffff;
            var value = (word >> 16) & 0xff;
            var op = word & 0xff000000;

            switch (op) {
                case ProbeFlags.SCANLINE:
                    row++;
                    col = 0;
                    break;
                case ProbeFlags.FRAME:
                    row = 0;
                    col = 0;
                    break;
                case ProbeFlags.CLOCKS:
                    col += addr;
                    clk += addr;
                    break;
                default:
                    eventfn(op, addr, col, row, clk, value);
                    break;
            }
        }
    }

    opToString(op: number, addr?: number, value?: number) {
        var s = "";
        switch (op) {
            case ProbeFlags.EXECUTE:
                s = "Exec";
                break;
            case ProbeFlags.MEM_READ:
                s = "Read";
                break;
            case ProbeFlags.MEM_WRITE:
                s = "Write";
                break;
            case ProbeFlags.IO_READ:
                s = "IO Read";
                break;
            case ProbeFlags.IO_WRITE:
                s = "IO Write";
                break;
            case ProbeFlags.VRAM_READ:
                s = "VRAM Read";
                break;
            case ProbeFlags.VRAM_WRITE:
                s = "VRAM Write";
                break;
            case ProbeFlags.INTERRUPT:
                s = "Interrupt";
                break;
            case ProbeFlags.ILLEGAL:
                s = "Error";
                break;
            case ProbeFlags.SP_PUSH:
                s = "Stack Push";
                break;
            case ProbeFlags.SP_POP:
                s = "Stack Pop";
                break;
            default:
                return "";
        }

        if (typeof addr == 'number') {
            s += " " + this.addr2str(addr);
        }

        if ((op & ProbeFlags.HAS_VALUE) && typeof value == 'number') {
            s += " = $" + hex(value, 2);
        }

        return s;
    }

    getOpRGB(op: number): number {
        switch (op) {
            case ProbeFlags.EXECUTE:
                return 0x018001;
            case ProbeFlags.MEM_READ:
                return 0x800101;
            case ProbeFlags.MEM_WRITE:
                return 0x010180;
            case ProbeFlags.IO_READ:
                return 0x018080;
            case ProbeFlags.IO_WRITE:
                return 0xc00180;
            case ProbeFlags.VRAM_READ:
                return 0x808001;
            case ProbeFlags.VRAM_WRITE:
                return 0x4080c0;
            case ProbeFlags.INTERRUPT:
                return 0xcfcfcf;
            case ProbeFlags.ILLEGAL:
                return 0x3f3fff;
            default:
                return 0;
        }
    }
}

export class ProbeLogView extends ProbeViewBaseBase {
    vlist: VirtualTextScroller;
    maindiv: HTMLElement;
    recreateOnResize = true;
    dumplines;

    createDiv(parent: HTMLElement) {
        this.vlist = new VirtualTextScroller(parent);
        this.vlist.create(parent, this.cyclesPerLine * this.totalScanlines, this.getMemoryLineAt.bind(this));
        return this.vlist.maindiv;
    }

    getMemoryLineAt(row: number): VirtualTextLine {
        var s: string = "";
        var c: string = "seg_data";
        var line = this.dumplines && this.dumplines[row];

        if (line != null) {
            var xtra: string = line.info.join(", ");
            s = "(" + lpad(line.row, 4) + ", " + lpad(line.col, 4) + ")  " + rpad(line.asm || "", 20) + xtra;
            if (xtra.indexOf("Write ") >= 0) c = "seg_io";
        }

        return {text: s, clas: c};
    }

    refresh() {
        this.tick();
    }

    tick() {
        const isz80 = platform instanceof BaseZ80MachinePlatform || platform instanceof BaseZ80Platform;

        // cache each line in frame
        this.dumplines = {};
        this.redraw((op, addr, col, row, clk, value) => {
            if (isz80) clk >>= 2;

            var line = this.dumplines[clk];
            if (line == null) {
                line = {
                    op: op,
                    addr: addr,
                    row: row,
                    col: col,
                    asm: null,
                    info: []
                };
                this.dumplines[clk] = line;
            }

            switch (op) {
                case ProbeFlags.EXECUTE:
                    if (platform.disassemble) {
                        var disasm = platform.disassemble(addr, platform.readAddress.bind(platform));
                        line.asm = disasm && disasm.line;
                    }
                    break;
                default:
                    var xtra = this.opToString(op, addr, value);
                    if (xtra != "") line.info.push(xtra);
                    break;
            }
        });

        this.vlist.refresh();
    }
}

export class ScanlineIOView extends ProbeViewBaseBase {
    vlist: VirtualTextScroller;
    maindiv: HTMLElement;
    recreateOnResize = true;
    dumplines;

    createDiv(parent: HTMLElement) {
        this.vlist = new VirtualTextScroller(parent);
        this.vlist.create(parent, this.totalScanlines, this.getMemoryLineAt.bind(this));
        return this.vlist.maindiv;
    }

    getMemoryLineAt(row: number): VirtualTextLine {
        var s = lpad(row + "", 3) + ' ';
        var c = 'seg_code';
        var line = (this.dumplines && this.dumplines[row]) || [];
        var hblankCycle = Math.round(this.cyclesPerLine / 3.3);

        for (var i = 0; i < this.cyclesPerLine; i++) {
            var opaddr = line[i];

            if (opaddr !== undefined) {
                var addr = opaddr & 0xffff;
                var op = op & 0xff000000;

                if (op == ProbeFlags.EXECUTE) {
                    s += ',';
                } else {
                    var v = hex(addr);
                    s += v;
                    i += v.length - 1;
                }
            } else {
                s += (i == hblankCycle) ? '|' : '.';
            }
        }

        if (line[-1]) {
            s += ' ' + line[-1]; // executing symbol
        }

        return {text: s, clas: c};
    }

    refresh() {
        this.tick();
    }

    tick() {
        // cache each line in frame
        this.dumplines = {};
        this.redraw((op, addr, col, row, clk, value) => {
            var line = this.dumplines[row];
            if (line == null) {
                this.dumplines[row] = line = [];
            }

            switch (op) {
                case ProbeFlags.EXECUTE:
                    var sym = platform.debugSymbols.addr2symbol[addr];
                    if (sym) line[-1] = sym;
                    break;
                case ProbeFlags.IO_READ:
                case ProbeFlags.IO_WRITE:
                case ProbeFlags.VRAM_READ:
                case ProbeFlags.VRAM_WRITE:
                    line[col] = op | addr;
                    break;
            }
        });

        this.vlist.refresh();
    }
}

export class ProbeSymbolView extends ProbeViewBaseBase {
    vlist: VirtualTextScroller;
    keys: string[];
    recreateOnResize = true;
    dumplines;
    cumulativeData = true;

    createDiv(parent: HTMLElement) {
        if (platform.debugSymbols && platform.debugSymbols.symbolmap) {
            this.keys = Array.from(Object.keys(platform.debugSymbols.symbolmap).filter(sym => !ignoreSymbol(sym)));
        } else {
            this.keys = ['no symbols defined'];
        }

        this.vlist = new VirtualTextScroller(parent);
        this.vlist.create(parent, this.keys.length + 1, this.getMemoryLineAt.bind(this));

        return this.vlist.maindiv;
    }

    getMemoryLineAt(row: number): VirtualTextLine {
        // header line
        if (row == 0) {
            return {text: lpad("Symbol", 35) + lpad("Reads", 8) + lpad("Writes", 8)};
        }

        var sym = this.keys[row - 1];
        var line = this.dumplines && this.dumplines[sym];

        function getop(op) {
            var n = line[op] | 0;
            return lpad(n ? n.toString() : "", 8);
        }

        var s: string;
        var c: string;
        if (line != null) {
            s = lpad(sym, 35)
                + getop(ProbeFlags.MEM_READ)
                + getop(ProbeFlags.MEM_WRITE);
            if (line[ProbeFlags.EXECUTE]) {
                c = 'seg_code';
            } else if (line[ProbeFlags.IO_READ] || line[ProbeFlags.IO_WRITE]) {
                c = 'seg_io';
            } else {
                c = 'seg_data';
            }
        } else {
            s = lpad(sym, 35);
            c = 'seg_unknown';
        }

        return {text: s, clas: c};
    }

    refresh() {
        this.tick();
    }

    tick() {
        // cache each line in frame
        this.dumplines = {};
        this.redraw((op, addr, col, row, clk, value) => {
            var sym = platform.debugSymbols.addr2symbol[addr];
            if (sym != null) {
                var line = this.dumplines[sym];
                if (line == null) {
                    line = {};
                    this.dumplines[sym] = line;
                }

                line[op] = (line[op] | 0) + 1;
            }
        });

        this.vlist.refresh();

        if (this.probe) {
            this.probe.clear(); // clear cumulative data
        }
    }
}
