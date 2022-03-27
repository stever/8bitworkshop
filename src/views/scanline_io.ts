import {hex, lpad} from "../util";
import {ProbeFlags} from "../emulator/recorder";
import {platform} from "../ui";
import {ProbeViewBaseBase, VirtualTextLine, VirtualTextScroller} from "./views";

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
