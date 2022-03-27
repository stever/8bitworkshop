import {platform} from "./ui";
import {hex} from "./util";
import {VirtualList} from "./vlist";
import {ProbeFlags, ProbeRecorder} from "./emulator/recorder";
import {MemoryView} from "./views/memory_browser";
import {ProjectView} from "./baseviews";

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

export class VRAMMemoryView extends MemoryView {
    totalRows = 0x800;

    readAddress(n: number) {
        return platform.readVRAMAddress(n);
    }

    getMemorySegment(a: number): string {
        return 'video';
    }

    getDumpLines() {
        return null;
    }
}

export class BinaryFileView implements ProjectView {
    vlist: VirtualTextScroller;
    maindiv: HTMLElement;
    path: string;
    data: Uint8Array;
    recreateOnResize = true;

    constructor(path: string, data: Uint8Array) {
        this.path = path;
        this.data = data;
    }

    createDiv(parent: HTMLElement) {
        this.vlist = new VirtualTextScroller(parent);
        this.vlist.create(parent, ((this.data.length + 15) >> 4), this.getMemoryLineAt.bind(this));
        return this.vlist.maindiv;
    }

    getMemoryLineAt(row: number): VirtualTextLine {
        var offset = row * 16;
        var n1 = 0;
        var n2 = 16;
        var s = hex(offset + n1, 4) + ' ';

        for (var i = 0; i < n1; i++) {
            s += '   ';
        }

        if (n1 > 8) {
            s += ' ';
        }

        for (var i = n1; i < n2; i++) {
            var read = this.data[offset + i];
            if (i == 8) s += ' ';
            s += ' ' + (read >= 0 ? hex(read, 2) : '  ');
        }

        return {text: s};
    }

    refresh() {
        this.vlist.refresh();
    }

    getPath() {
        return this.path;
    }
}
