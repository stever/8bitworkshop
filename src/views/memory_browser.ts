import {ProjectView} from "../baseviews";
import {VirtualList} from "../vlist";
import {getVisibleEditorLineHeight, ignoreSymbol} from "../views";
import {compparams, current_project, platform} from "../ui";
import {hex} from "../util";

export class MemoryView implements ProjectView {
    memorylist;
    dumplines;
    maindiv: HTMLElement;
    recreateOnResize = true;
    totalRows = 0x1400;

    createDiv(parent: HTMLElement) {
        var div = document.createElement('div');
        div.setAttribute("class", "memdump");
        parent.appendChild(div);
        this.showMemoryWindow(parent, div);
        return this.maindiv = div;
    }

    showMemoryWindow(workspace: HTMLElement, parent: HTMLElement) {
        this.memorylist = new VirtualList({
            w: $(workspace).width(),
            h: $(workspace).height(),
            itemHeight: getVisibleEditorLineHeight(),
            totalRows: this.totalRows,
            generatorFn: (row: number) => {
                var s = this.getMemoryLineAt(row);
                var linediv = document.createElement("div");

                if (this.dumplines) {
                    var dlr = this.dumplines[row];
                    if (dlr) {
                        linediv.classList.add('seg_' + this.getMemorySegment(this.dumplines[row].a));
                    }
                }

                linediv.appendChild(document.createTextNode(s));
                return linediv;
            }
        });

        $(parent).append(this.memorylist.container);

        this.tick();

        if (compparams && this.dumplines) {
            this.scrollToAddress(compparams.data_start);
        }
    }

    scrollToAddress(addr: number) {
        if (this.dumplines) {
            this.memorylist.scrollToItem(this.findMemoryWindowLine(addr));
        }
    }

    refresh() {
        this.dumplines = null;
        this.tick();
    }

    tick() {
        if (this.memorylist) {
            $(this.maindiv).find('[data-index]').each((i, e) => {
                var div = $(e);
                var row = parseInt(div.attr('data-index'));
                var oldtext = div.text();
                var newtext = this.getMemoryLineAt(row);
                if (oldtext != newtext)
                    div.text(newtext);
            });
        }
    }

    getMemoryLineAt(row: number): string {
        var offset = row * 16;
        var n1 = 0;
        var n2 = 16;
        var sym;

        if (this.getDumpLines()) {
            var dl = this.dumplines[row];

            if (dl) {
                offset = dl.a & 0xfff0;
                n1 = dl.a - offset;
                n2 = n1 + dl.l;
                sym = dl.s;
            } else {
                return '.';
            }
        }

        var s = hex(offset + n1, 4) + ' ';

        for (var i = 0; i < n1; i++) {
            s += '   ';
        }

        if (n1 > 8) {
            s += ' ';
        }

        for (var i = n1; i < n2; i++) {
            var read = this.readAddress(offset + i);
            if (i == 8) s += ' ';
            s += ' ' + (typeof read == 'number' ? hex(read, 2) : '??');
        }

        for (var i = n2; i < 16; i++) {
            s += '   ';
        }

        if (sym) {
            s += '  ' + sym;
        }

        return s;
    }

    readAddress(n: number) {
        return platform.readAddress(n);
    }

    getDumpLineAt(line: number) {
        var d = this.dumplines[line];
        if (d) {
            return d.a + " " + d.s;
        }
    }

    getDumpLines() {
        var addr2sym = (platform.debugSymbols && platform.debugSymbols.addr2symbol) || {};

        if (this.dumplines == null) {
            this.dumplines = [];

            var ofs = 0;
            var sym;

            for (const _nextofs of Object.keys(addr2sym)) {
                var nextofs = parseInt(_nextofs); // convert from string (stupid JS)
                var nextsym = addr2sym[nextofs];

                if (sym) {

                    // ignore certain symbols
                    if (ignoreSymbol(sym)) {
                        sym = '';
                    }

                    while (ofs < nextofs && this.dumplines.length < 0x10000) {
                        var ofs2 = (ofs + 16) & 0xffff0;
                        if (ofs2 > nextofs) ofs2 = nextofs;

                        //if (ofs < 1000) console.log(ofs, ofs2, nextofs, sym);

                        this.dumplines.push({a: ofs, l: ofs2 - ofs, s: sym});
                        ofs = ofs2;
                    }
                }

                sym = nextsym;
            }
        }

        return this.dumplines;
    }

    getMemorySegment(a: number): string {
        if (compparams) {
            if (a >= compparams.data_start && a < compparams.data_start + compparams.data_size) {
                if (platform.getSP && a >= platform.getSP() - 15) {
                    return 'stack';
                } else {
                    return 'data';
                }
            } else if (
                a >= compparams.code_start &&
                a < compparams.code_start + (compparams.code_size || compparams.rom_size)) {
                return 'code';
            }
        }

        var segments = current_project.segments;
        if (segments) {
            for (var seg of segments) {
                if (a >= seg.start && a < seg.start + seg.size) {
                    if (seg.type == 'rom') return 'code';
                    if (seg.type == 'ram') return 'data';
                    if (seg.type == 'io') return 'io';
                }
            }
        }

        return 'unknown';
    }

    findMemoryWindowLine(a: number): number {
        for (var i = 0; i < this.dumplines.length; i++) {
            if (this.dumplines[i].a >= a) {
                return i;
            }
        }
    }
}
