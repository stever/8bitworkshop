import {lpad, rpad} from "../util";
import {platform} from "../ui";
import {ZXWASMPlatform} from "../emulator/zx_classes";
import {ProbeFlags} from "../emulator/recorder";
import {ProbeViewBaseBase, VirtualTextLine, VirtualTextScroller} from "../views";

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
        const isz80 = platform instanceof ZXWASMPlatform;

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
                    var disasm = platform.disassemble(addr, platform.readAddress.bind(platform));
                    line.asm = disasm && disasm.line;
                    break;
                default:
                    var xtra = this.opToString(op, addr, value);
                    if (xtra != "") {
                        line.info.push(xtra);
                    }

                    break;
            }
        });

        this.vlist.refresh();
    }
}
