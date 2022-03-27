import {isMobileDevice, ProjectView} from "./baseviews";
import {SourceFile, WorkerError, SourceLocation} from "./worker/types";
import {platform, current_project, lastDebugState, runToPC} from "./ui";
import {hex, rpad} from "./util";
import {DisassemblerView} from "./views/disassembly";

declare var CodeMirror;

// helper function for editor
export function jumpToLine(ed, i: number) {
    var t = ed.charCoords({line: i, ch: 0}, "local").top;
    var middleHeight = ed.getScrollerElement().offsetHeight / 2;
    ed.scrollTo(null, t - middleHeight - 5);
}

function createTextSpan(text: string, className: string): HTMLElement {
    var span = document.createElement("span");
    span.setAttribute("class", className);
    span.appendChild(document.createTextNode(text));
    return span;
}

const MAX_ERRORS = 200;

const MODEDEFS = {
    default: {theme: 'mbo'}, // NOTE: Not merged w/ other modes
    '6502': {isAsm: true},
    z80: {isAsm: true},
    jsasm: {isAsm: true},
    gas: {isAsm: true},
    vasm: {isAsm: true},
    inform6: {theme: 'cobalt'},
    markdown: {lineWrap: true},
    fastbasic: {noGutters: true},
    basic: {noLineNumbers: true, noGutters: true}
}

export var textMapFunctions = {
    input: null
}

export class SourceEditor implements ProjectView {
    constructor(path: string, mode: string) {
        this.path = path;
        this.mode = mode;
    }

    path: string;
    mode: string;
    editor;
    updateTimer = null;
    dirtylisting = true;
    sourcefile: SourceFile;
    currentDebugLine: SourceLocation;
    markCurrentPC; // TextMarker
    markHighlight; // TextMarker
    errormsgs = [];
    errorwidgets = [];
    errormarks = [];
    inspectWidget;

    createDiv(parent: HTMLElement) {
        var div = document.createElement('div');
        div.setAttribute("class", "editor");
        parent.appendChild(div);

        var text = current_project.getFile(this.path) as string;

        this.newEditor(div);

        if (text) {
            this.setText(text);
            this.editor.setSelection({line: 0, ch: 0}, {
                line: 0,
                ch: 0
            }, {scroll: true}); // move cursor to start
        }

        this.setupEditor();

        return div;
    }

    setVisible(showing: boolean): void {
        if (showing) {
            this.editor.focus(); // so that keyboard works when moving between files
        }
    }

    newEditor(parent: HTMLElement) {
        var modedef = MODEDEFS[this.mode] || MODEDEFS.default;
        var isAsm = modedef.isAsm;
        var lineWrap = !!modedef.lineWrap;
        var theme = modedef.theme || MODEDEFS.default.theme;
        var lineNums = !modedef.noLineNumbers && !isMobileDevice;
        var gutters = ["CodeMirror-linenumbers", "gutter-offset", "gutter-info"];

        if (isAsm) {
            gutters = ["CodeMirror-linenumbers", "gutter-offset", "gutter-bytes", "gutter-clock", "gutter-info"];
        }

        if (modedef.noGutters || isMobileDevice) {
            gutters = ["gutter-info"];
        }

        this.editor = CodeMirror(parent, {
            theme: theme,
            lineNumbers: lineNums,
            matchBrackets: true,
            tabSize: 8,
            indentAuto: true,
            lineWrapping: lineWrap,
            gutters: gutters
        });
    }

    editorChanged() {
        clearTimeout(this.updateTimer);

        this.updateTimer = setTimeout(() => {
            current_project.updateFile(this.path, this.editor.getValue());
        }, 300);

        if (this.markHighlight) {
            this.markHighlight.clear();
            this.markHighlight = null;
        }
    }

    setupEditor() {
        // update file in project (and recompile) when edits made
        this.editor.on('changes', (ed, changeobj) => {
            this.editorChanged();
        });

        // inspect symbol when it's highlighted (double-click)
        this.editor.on('cursorActivity', (ed) => {
            this.inspectUnderCursor();
        });

        // gutter clicked
        this.editor.on("gutterClick", (cm, n) => {
            this.toggleBreakpoint(n);
        });

        // set editor mode for highlighting, etc
        this.editor.setOption("mode", this.mode);

        // change text?
        this.editor.on('beforeChange', (cm, chgobj) => {
            if (textMapFunctions.input && chgobj.text) chgobj.text = chgobj.text.map(textMapFunctions.input);
        });
    }

    inspectUnderCursor() {
        var start = this.editor.getCursor(true);
        var end = this.editor.getCursor(false);

        if (start.line == end.line && start.ch < end.ch && end.ch - start.ch < 80) {
            var name = this.editor.getSelection();
            this.inspect(name);
        } else {
            this.inspect(null);
        }
    }

    inspect(ident: string): void {
        var result;
        if (platform.inspect) {
            result = platform.inspect(ident);
        }

        if (this.inspectWidget) {
            this.inspectWidget.clear();
            this.inspectWidget = null;
        }

        if (result) {
            var infospan = createTextSpan(result, "tooltipinfoline");
            var line = this.editor.getCursor().line;
            this.inspectWidget = this.editor.addLineWidget(line, infospan, {above: false});
        }
    }

    setText(text: string) {
        var oldtext = this.editor.getValue();
        if (oldtext != text) {
            this.editor.setValue(text);

            // clear history if setting empty editor
            if (oldtext == '') {
                this.editor.clearHistory();
            }
        }
    }

    insertText(text: string) {
        var cur = this.editor.getCursor();
        this.editor.replaceRange(text, cur, cur);
    }

    highlightLines(start: number, end: number) {
        var cls = 'hilite-span'
        var markOpts = {className: cls, inclusiveLeft: true};

        this.markHighlight = this.editor.markText({
            line: start,
            ch: 0
        }, {line: end, ch: 0}, markOpts);

        this.editor.scrollIntoView({
            from: {line: start, ch: 0},
            to: {line: end, ch: 0}
        });
    }

    replaceSelection(start: number, end: number, text: string) {
        this.editor.setSelection(this.editor.posFromIndex(start), this.editor.posFromIndex(end));
        this.editor.replaceSelection(text);
    }

    getValue(): string {
        return this.editor.getValue();
    }

    getPath(): string {
        return this.path;
    }

    addError(info: WorkerError) {
        // only mark errors with this filename, or without any filename
        if (!info.path || this.path.endsWith(info.path)) {
            var numLines = this.editor.lineCount();
            var line = info.line - 1;

            if (line < 0 || line >= numLines) {
                line = 0;
            }

            this.addErrorMarker(line, info.msg);

            if (info.start != null) {
                var markOpts = {className: "mark-error", inclusiveLeft: true};

                var start = {
                    line: line,
                    ch: info.end ? info.start : info.start - 1
                };

                var end = {line: line, ch: info.end ? info.end : info.start};
                var mark = this.editor.markText(start, end, markOpts);

                this.errormarks.push(mark);
            }
        }
    }

    addErrorMarker(line: number, msg: string) {
        var div = document.createElement("div");
        div.setAttribute("class", "tooltipbox tooltiperror");
        div.appendChild(document.createTextNode("\u24cd"));

        this.editor.setGutterMarker(line, "gutter-info", div);
        this.errormsgs.push({line: line, msg: msg});

        // expand line widgets when mousing over errors
        $(div).mouseover((e) => {
            this.expandErrors();
        });
    }

    addErrorLine(line: number, msg: string) {
        var errspan = createTextSpan(msg, "tooltiperrorline");
        this.errorwidgets.push(this.editor.addLineWidget(line, errspan));
    }

    expandErrors() {
        var e;
        while (e = this.errormsgs.shift()) {
            this.addErrorLine(e.line, e.msg);
        }
    }

    markErrors(errors: WorkerError[]) {
        this.clearErrors();
        errors = errors.slice(0, MAX_ERRORS);
        for (var info of errors) {
            this.addError(info);
        }
    }

    clearErrors() {
        this.dirtylisting = true;
        // clear line widgets
        this.editor.clearGutter("gutter-info");
        this.errormsgs = [];
        while (this.errorwidgets.length) this.errorwidgets.shift().clear();
        while (this.errormarks.length) this.errormarks.shift().clear();
    }

    getSourceFile(): SourceFile {
        return this.sourcefile;
    }

    updateListing() {
        // update editor annotations
        this.clearErrors();
        this.editor.clearGutter("gutter-bytes");
        this.editor.clearGutter("gutter-offset");
        this.editor.clearGutter("gutter-clock");

        var lstlines = this.sourcefile.lines || [];
        for (var info of lstlines) {
            if (info.offset >= 0) {
                this.setGutter("gutter-offset", info.line - 1, hex(info.offset & 0xffff, 4));
            }

            if (info.insns) {
                var insnstr = info.insns.length > 9 ? ("...") : info.insns;
                this.setGutter("gutter-bytes", info.line - 1, insnstr);

                if (info.iscode) {
                    if (info.cycles) {
                        this.setGutter("gutter-clock", info.line - 1, info.cycles + "");
                    } else if (platform.getOpcodeMetadata) {
                        var opcode = parseInt(info.insns.split(" ")[0], 16);
                        var meta = platform.getOpcodeMetadata(opcode, info.offset);

                        if (meta && meta.minCycles) {
                            var clockstr = meta.minCycles + "";
                            this.setGutter("gutter-clock", info.line - 1, clockstr);
                        }
                    }
                }
            }
        }
    }

    setGutter(type: string, line: number, text: string) {
        var lineinfo = this.editor.lineInfo(line);
        if (lineinfo && lineinfo.gutterMarkers && lineinfo.gutterMarkers[type]) {
            // do not replace existing marker
        } else {
            var textel = document.createTextNode(text);
            this.editor.setGutterMarker(line, type, textel);
        }
    }

    setGutterBytes(line: number, s: string) {
        this.setGutter("gutter-bytes", line - 1, s);
    }

    setCurrentLine(line: SourceLocation, moveCursor: boolean) {
        var blocked = platform.isBlocked && platform.isBlocked();

        var addCurrentMarker = (line: SourceLocation) => {
            var div = document.createElement("div");
            var cls = blocked ? 'currentpc-marker-blocked' : 'currentpc-marker';
            div.classList.add(cls);
            div.appendChild(document.createTextNode("\u25b6"));
            this.editor.setGutterMarker(line.line - 1, "gutter-info", div);
        }

        this.clearCurrentLine(moveCursor);

        if (line) {
            addCurrentMarker(line);

            if (moveCursor) {
                this.editor.setCursor({
                    line: line.line - 1,
                    ch: line.start || 0
                }, {scroll: true});
            }

            var cls = blocked ? 'currentpc-span-blocked' : 'currentpc-span';
            var markOpts = {className: cls, inclusiveLeft: true};

            if (line.start || line.end) {
                this.markCurrentPC = this.editor.markText({
                    line: line.line - 1,
                    ch: line.start
                }, {
                    line: line.line - 1,
                    ch: line.end || line.start + 1
                }, markOpts);
            } else {
                this.markCurrentPC = this.editor.markText({
                    line: line.line - 1,
                    ch: 0
                }, {line: line.line, ch: 0}, markOpts);
            }

            this.currentDebugLine = line;
        }
    }

    clearCurrentLine(moveCursor: boolean) {
        if (this.currentDebugLine) {
            this.editor.clearGutter("gutter-info");
            if (moveCursor) this.editor.setSelection(this.editor.getCursor());
            this.currentDebugLine = null;
        }

        if (this.markCurrentPC) {
            this.markCurrentPC.clear();
            this.markCurrentPC = null;
        }
    }

    getActiveLine(): SourceLocation {
        if (this.sourcefile) {
            var cpustate = lastDebugState && lastDebugState.c;
            if (!cpustate && platform.getCPUState && !platform.isRunning()) {
                cpustate = platform.getCPUState();
            }

            if (cpustate) {
                var EPC = (cpustate && (cpustate.EPC || cpustate.PC));
                var res = this.sourcefile.findLineForOffset(EPC, 15);
                return res;
            }
        }
    }

    refreshDebugState(moveCursor: boolean) {
        this.clearCurrentLine(moveCursor);
        var line = this.getActiveLine();
        if (line) {
            this.setCurrentLine(line, moveCursor);
        }
    }

    refreshListing() {
        // lookup corresponding sourcefile for this file, using listing
        var lst = current_project.getListingForFile(this.path);
        if (lst && lst.sourcefile && lst.sourcefile !== this.sourcefile) {
            this.sourcefile = lst.sourcefile;
            this.dirtylisting = true;
        }

        if (!this.sourcefile || !this.dirtylisting) {
            return;
        }

        this.updateListing();
        this.dirtylisting = false;
    }

    refresh(moveCursor: boolean) {
        this.refreshListing();
        this.refreshDebugState(moveCursor);
    }

    tick() {
        this.refreshDebugState(false);
    }

    getLine(line: number) {
        return this.editor.getLine(line - 1);
    }

    getCurrentLine(): number {
        return this.editor.getCursor().line + 1;
    }

    getCursorPC(): number {
        var line = this.getCurrentLine();

        while (this.sourcefile && line >= 0) {
            var pc = this.sourcefile.line2offset[line];
            if (pc >= 0) return pc;
            line--;
        }

        return -1;
    }

    undoStep() {
        this.editor.execCommand('undo');
    }

    toggleBreakpoint(lineno: number) {
        if (this.sourcefile != null) {
            var targetPC = this.sourcefile.line2offset[lineno + 1];
            runToPC(targetPC);
        }
    }
}

export class ListingView extends DisassemblerView implements ProjectView {
    assemblyfile: SourceFile;
    path: string;

    constructor(lstfn: string) {
        super();
        this.path = lstfn;
    }

    refreshListing() {
        // lookup corresponding assemblyfile for this file, using listing
        var lst = current_project.getListingForFile(this.path);
        this.assemblyfile = lst && (lst.assemblyfile || lst.sourcefile);
    }

    refresh(moveCursor: boolean) {
        this.refreshListing();

        // load listing text into editor
        if (!this.assemblyfile) return;
        var asmtext = this.assemblyfile.text;
        var disasmview = this.getDisasmView();
        disasmview.setValue(asmtext);

        // go to PC
        if (!platform.saveState) return;
        var state = lastDebugState || platform.saveState();
        var pc = state.c ? (state.c.EPC || state.c.PC) : 0;
        if (pc >= 0 && this.assemblyfile) {
            var res = this.assemblyfile.findLineForOffset(pc, 15);
            if (res) {

                // set cursor while debugging
                if (moveCursor) {
                    disasmview.setCursor(res.line - 1, 0);
                }

                jumpToLine(disasmview, res.line - 1);
            }
        }
    }
}
