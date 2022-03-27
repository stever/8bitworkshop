import {ProjectView} from "../baseviews";
import {lastDebugState, platform} from "../ui";
import {hex, rpad} from "../util";
import {jumpToLine} from "../editors";

declare var CodeMirror;

const disasmWindow = 1024; // disassemble this many bytes around cursor

export class DisassemblerView implements ProjectView {
    disasmview;

    getDisasmView() {
        return this.disasmview;
    }

    createDiv(parent: HTMLElement) {
        var div = document.createElement('div');
        div.setAttribute("class", "editor");
        parent.appendChild(div);
        this.newEditor(div);
        return div;
    }

    newEditor(parent: HTMLElement) {
        this.disasmview = CodeMirror(parent, {
            mode: 'z80',
            theme: 'cobalt',
            tabSize: 8,
            readOnly: true,
            styleActiveLine: true
        });
    }

    refresh(moveCursor: boolean) {
        let state = lastDebugState || platform.saveState();
        let pc = state.c ? state.c.PC : 0;
        let curline = 0;
        let selline = 0;
        let addr2symbol = (platform.debugSymbols && platform.debugSymbols.addr2symbol) || {};

        let disassemble = (start, len) => {
            let s = "";
            let ofs = 0;
            while (ofs < len) {
                let a = (start + ofs) | 0;
                let disasm = platform.disassemble(a, platform.readAddress.bind(platform));
                let bytes = "";
                let comment = "";

                for (let i = 0; i < disasm.nbytes; i++) {
                    bytes += hex(platform.readAddress(a + i));
                }

                while (bytes.length < 14) {
                    bytes += ' ';
                }

                let dstr = disasm.line;

                if (addr2symbol && disasm.isaddr) {
                    dstr = dstr.replace(/([^#])[$]([0-9A-F]+)/, (substr: string, ...args: any[]): string => {
                        let addr = parseInt(args[1], 16);

                        let sym = addr2symbol[addr];
                        if (sym) {
                            return (args[0] + sym);
                        }

                        sym = addr2symbol[addr - 1];
                        if (sym) {
                            return (args[0] + sym + "+1");
                        }

                        return substr;
                    });
                }

                if (addr2symbol) {
                    let sym = addr2symbol[a];
                    if (sym) {
                        comment = "; " + sym;
                    }
                }

                let dline = hex(a, 4) + "\t" + rpad(bytes, 14) + "\t" + rpad(dstr, 30) + comment + "\n";
                s += dline;

                if (a == pc) {
                    selline = curline;
                }

                curline++;
                ofs += disasm.nbytes || 1;
            }

            return s;
        }

        var startpc = pc < 0 ? pc - disasmWindow : Math.max(0, pc - disasmWindow); // for 32-bit PCs w/ hi bit set
        let text = disassemble(startpc, pc - startpc) + disassemble(pc, disasmWindow);
        this.disasmview.setValue(text);

        if (moveCursor) {
            this.disasmview.setCursor(selline, 0);
        }

        jumpToLine(this.disasmview, selline);
    }

    getCursorPC(): number {
        var line = this.disasmview.getCursor().line;
        if (line >= 0) {
            var toks = this.disasmview.getLine(line).trim().split(/\s+/);
            if (toks && toks.length >= 1) {
                var pc = parseInt(toks[0], 16);
                if (pc >= 0) return pc;
            }
        }

        return -1;
    }
}
