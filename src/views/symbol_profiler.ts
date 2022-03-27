import {platform} from "../ui";
import {lpad} from "../util";
import {ProbeFlags} from "../emulator/recorder";
import {
    ignoreSymbol,
    ProbeViewBaseBase,
    VirtualTextLine,
    VirtualTextScroller
} from "../views";

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
