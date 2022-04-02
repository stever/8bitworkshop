import type {BuildOptions, FileData, FileEntry, WorkerResult} from "./types";
import {BuildStep, EmscriptenModule, SourceLine, WorkerError, WorkerMessage} from "./interfaces";
import {Builder} from "./Builder";
import {emglobal, PLATFORM_PARAMS, TOOL_PRELOADFS} from "./global_vars";
import {errorResult} from "./util";
import {FileWorkingStore} from "./FileWorkingStore";

declare function importScripts(path: string);

declare function postMessage(msg);

// WebAssembly module cache
var _WASM_module_cache = {};
var CACHE_WASM_MODULES = true; // if false, use asm.js only

function getWASMModule(module_id: string) {
    var module = _WASM_module_cache[module_id];

    if (!module) {
        starttime();
        module = new WebAssembly.Module(wasmBlob[module_id]);

        if (CACHE_WASM_MODULES) {
            _WASM_module_cache[module_id] = module;
            delete wasmBlob[module_id];
        }

        endtime("module creation " + module_id);
    }

    return module;
}

// function for use with instantiateWasm
export function moduleInstFn(module_id: string) {
    return function (imports, ri) {
        var mod = getWASMModule(module_id);
        var inst = new WebAssembly.Instance(mod, imports);
        ri(inst);
        return inst.exports;
    }
}

var _t1;

export function starttime() {
    _t1 = new Date();
}

export function endtime(msg) {
    var _t2 = new Date();
    console.log(msg, _t2.getTime() - _t1.getTime(), "ms");
}

/// working file store and build steps

export var store = new FileWorkingStore();

var builder = new Builder();

export function putWorkFile(path: string, data: FileData) {
    return store.putFile(path, data);
}

export function getWorkFileAsString(path: string): string {
    return store.getFileAsString(path);
}

export function populateEntry(fs, path: string, entry: FileEntry, options: BuildOptions) {
    var data = entry.data;
    if (options && options.processFn) {
        data = options.processFn(path, data);
    }

    // create subfolders
    var toks = path.split('/');
    if (toks.length > 1) {
        for (var i = 0; i < toks.length - 1; i++) {
            try {
                fs.mkdir(toks[i]);
            } catch (e) {
                console.log(e);
            }
        }
    }

    // write file
    fs.writeFile(path, data, {encoding: entry.encoding});
    var time = new Date(entry.ts);
    fs.utime(path, time, time);
    console.log("<<<", path, entry.data.length);
}

// can call multiple times (from populateFiles)
export function gatherFiles(step: BuildStep, options?: BuildOptions): number {
    var maxts = 0;
    if (step.files) {
        for (var i = 0; i < step.files.length; i++) {
            var path = step.files[i];
            var entry = store.workfs[path];

            if (!entry) {
                throw new Error("No entry for path '" + path + "'");
            } else {
                maxts = Math.max(maxts, entry.ts);
            }
        }
    } else if (step.code) {
        var path = step.path ? step.path : options.mainFilePath; // TODO: what if options null

        if (!path) {
            throw Error("need path or mainFilePath");
        }

        var code = step.code;
        var entry = putWorkFile(path, code);
        step.path = path;
        step.files = [path];
        maxts = entry.ts;
    } else if (step.path) {
        var path = step.path;
        var entry = store.workfs[path];
        maxts = entry.ts;
        step.files = [path];
    }

    if (step.path && !step.prefix) {
        step.prefix = getPrefix(step.path);
    }

    step.maxts = maxts;
    return maxts;
}

export function getPrefix(s: string): string {
    var pos = s.lastIndexOf('.');
    return (pos > 0) ? s.substring(0, pos) : s;
}

export function populateFiles(step: BuildStep, fs, options?: BuildOptions) {
    gatherFiles(step, options);

    if (!step.files) {
        throw Error("call gatherFiles() first");
    }

    for (var i = 0; i < step.files.length; i++) {
        var path = step.files[i];
        populateEntry(fs, path, store.workfs[path], options);
    }
}

export function populateExtraFiles(step: BuildStep, fs, extrafiles) {
    if (extrafiles) {
        for (var i = 0; i < extrafiles.length; i++) {
            var xfn = extrafiles[i];

            // is this file cached?
            if (store.workfs[xfn]) {
                fs.writeFile(xfn, store.workfs[xfn].data, {encoding: 'binary'});
                continue;
            }

            // fetch from network
            var xpath = "zx/" + xfn;
            var xhr = new XMLHttpRequest();
            xhr.responseType = 'arraybuffer';
            xhr.open("GET", PWORKER + xpath, false);  // synchronous request
            xhr.send(null);

            if (xhr.response && xhr.status == 200) {
                var data = new Uint8Array(xhr.response);
                fs.writeFile(xfn, data, {encoding: 'binary'});
                putWorkFile(xfn, data);
                console.log(":::", xfn, data.length);
            } else {
                throw Error("Could not load extra file " + xpath);
            }
        }
    }
}

export function staleFiles(step: BuildStep, targets: string[]) {
    if (!step.maxts) {
        throw Error("call populateFiles() first");
    }

    // see if any target files are more recent than inputs
    for (var i = 0; i < targets.length; i++) {
        var entry = store.workfs[targets[i]];
        if (!entry || step.maxts > entry.ts) {
            return true;
        }
    }

    console.log("unchanged", step.maxts, targets);
    return false;
}

export function anyTargetChanged(step: BuildStep, targets: string[]) {
    if (!step.maxts) {
        throw Error("call populateFiles() first");
    }

    // see if any target files are more recent than inputs
    for (var i = 0; i < targets.length; i++) {
        var entry = store.workfs[targets[i]];
        if (!entry || entry.ts > step.maxts) {
            return true;
        }
    }

    console.log("unchanged", step.maxts, targets);
    return false;
}

export function execMain(step: BuildStep, mod, args: string[]) {
    starttime();
    var run = mod.callMain || mod.run;
    run(args);
    endtime(step.tool);
}

/// asm.js / WASM / filesystem loading

var fsMeta = {};
var fsBlob = {};
var wasmBlob = {};

const PSRC = "../";
const PWORKER = PSRC + "worker/";

// load filesystems for CC65 and others asynchronously
function loadFilesystem(name: string) {
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.open("GET", PWORKER + "fs/fs" + name + ".data", false);  // synchronous request
    xhr.send(null);
    fsBlob[name] = xhr.response;
    xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.open("GET", PWORKER + "fs/fs" + name + ".js.metadata", false);  // synchronous request
    xhr.send(null);
    fsMeta[name] = xhr.response;
    console.log("Loaded " + name + " filesystem", fsMeta[name].files.length, 'files', fsBlob[name].size, 'bytes');
}

var loaded = {};

export function load(modulename: string, debug?: boolean) {
    if (!loaded[modulename]) {
        importScripts(PWORKER + 'asmjs/' + modulename + (debug ? "." + debug + ".js" : ".js"));
        loaded[modulename] = 1;
    }
}

export function loadWASM(modulename: string, debug?: boolean) {
    if (!loaded[modulename]) {
        importScripts(PWORKER + "wasm/" + modulename + (debug ? "." + debug + ".js" : ".js"));
        var xhr = new XMLHttpRequest();
        xhr.responseType = 'arraybuffer';
        xhr.open("GET", PWORKER + "wasm/" + modulename + ".wasm", false);  // synchronous request
        xhr.send(null);

        if (xhr.response) {
            wasmBlob[modulename] = new Uint8Array(xhr.response);
            console.log("Loaded " + modulename + ".wasm (" + wasmBlob[modulename].length + " bytes)");
            loaded[modulename] = 1;
        } else {
            throw Error("Could not load WASM file " + modulename + ".wasm");
        }
    }
}

export function loadNative(modulename: string) {
    // detect WASM
    if (CACHE_WASM_MODULES && typeof WebAssembly === 'object') {
        loadWASM(modulename);
    } else {
        load(modulename);
    }
}

// mount the filesystem at /share
export function setupFS(FS, name: string) {
    var WORKERFS = FS.filesystems['WORKERFS'];

    if (!fsMeta[name]) {
        throw Error("No filesystem for '" + name + "'");
    }

    FS.mkdir('/share');
    FS.mount(WORKERFS, {
        packages: [{metadata: fsMeta[name], blob: fsBlob[name]}]
    }, '/share');

    // fix for slow Blob operations by caching typed arrays
    // https://github.com/kripken/emscripten/blob/incoming/src/library_workerfs.js
    // https://bugs.chromium.org/p/chromium/issues/detail?id=349304#c30

    var reader = WORKERFS.reader;
    var blobcache = {};

    WORKERFS.stream_ops.read = function (stream, buffer, offset, length, position) {
        if (position >= stream.node.size) {
            return 0;
        }

        var contents = blobcache[stream.path];
        if (!contents) {
            var ab = reader.readAsArrayBuffer(stream.node.contents);
            contents = blobcache[stream.path] = new Uint8Array(ab);
        }

        if (position + length > contents.length) {
            length = contents.length - position;
        }

        for (var i = 0; i < length; i++) {
            buffer[offset + i] = contents[position + i];
        }

        return length;
    };
}

export var print_fn = function (s: string) {
    console.log(s);
}

// test.c(6) : warning 85: in function main unreferenced local variable : 'x'
// main.a (4): error: Unknown Mnemonic 'xxx'.
// at 2: warning 190: ISO C forbids an empty source file
export const re_msvc = /[/]*([^( ]+)\s*[(](\d+)[)]\s*:\s*(.+?):\s*(.*)/;
export const re_msvc2 = /\s*(at)\s+(\d+)\s*(:)\s*(.*)/;

export function msvcErrorMatcher(errors: WorkerError[]) {
    return function (s: string) {
        var matches = re_msvc.exec(s) || re_msvc2.exec(s);
        if (matches) {
            var errline = parseInt(matches[2]);
            errors.push({
                line: errline,
                path: matches[1],
                msg: matches[4]
            });
        } else {
            console.log(s);
        }
    }
}

export function makeErrorMatcher(errors: WorkerError[], regex, iline: number, imsg: number, mainpath: string, ifilename?: number) {
    return function (s) {
        var matches = regex.exec(s);
        if (matches) {
            errors.push({
                line: parseInt(matches[iline]) || 1,
                msg: matches[imsg],
                path: ifilename ? matches[ifilename] : mainpath
            });
        } else {
            console.log("??? " + s);
        }
    }
}

export function extractErrors(regex, strings: string[], path: string, iline, imsg, ifilename) {
    var errors = [];
    var matcher = makeErrorMatcher(errors, regex, iline, imsg, path, ifilename);

    for (var i = 0; i < strings.length; i++) {
        matcher(strings[i]);
    }

    return errors;
}

export const re_crlf = /\r?\n/;
export const re_lineoffset = /\s*(\d+)\s+[%]line\s+(\d+)\+(\d+)\s+(.+)/;

export function parseListing(code: string,
                             lineMatch, iline: number, ioffset: number, iinsns: number, icycles?: number,
                             funcMatch?, segMatch?): SourceLine[] {

    var lines: SourceLine[] = [];
    var lineofs = 0;
    var segment = '';
    var func = '';
    var funcbase = 0;

    code.split(re_crlf).forEach((line, lineindex) => {
        let segm = segMatch && segMatch.exec(line);
        if (segm) {
            segment = segm[1];
        }

        let funcm = funcMatch && funcMatch.exec(line);
        if (funcm) {
            funcbase = parseInt(funcm[1], 16);
            func = funcm[2];
        }

        var linem = lineMatch.exec(line);
        if (linem && linem[1]) {
            var linenum = iline < 0 ? lineindex : parseInt(linem[iline]);
            var offset = parseInt(linem[ioffset], 16);
            var insns = linem[iinsns];
            var cycles: number = icycles ? parseInt(linem[icycles]) : null;
            var iscode = cycles > 0;

            if (insns) {
                lines.push({
                    line: linenum + lineofs,
                    offset: offset - funcbase,
                    insns,
                    cycles,
                    iscode,
                    segment,
                    func
                });
            }
        } else {
            let m = re_lineoffset.exec(line);
            if (m) {
                lineofs = parseInt(m[2]) - parseInt(m[1]) - parseInt(m[3]);
            }
        }
    });

    return lines;
}

export function parseSourceLines(code: string, lineMatch, offsetMatch, funcMatch?, segMatch?) {
    var lines = [];
    var lastlinenum = 0;
    var segment = '';
    var func = '';
    var funcbase = 0;

    for (var line of code.split(re_crlf)) {
        let segm = segMatch && segMatch.exec(line);
        if (segm) {
            segment = segm[1];
        }

        let funcm = funcMatch && funcMatch.exec(line);
        if (funcm) {
            funcbase = parseInt(funcm[1], 16);
            func = funcm[2];
        }

        var linem = lineMatch.exec(line);
        if (linem && linem[1]) {
            lastlinenum = parseInt(linem[1]);
        } else if (lastlinenum) {
            var linem = offsetMatch.exec(line);
            if (linem && linem[1]) {
                var offset = parseInt(linem[1], 16);

                lines.push({
                    line: lastlinenum,
                    offset: offset - funcbase,
                    segment,
                    func
                });

                lastlinenum = 0;
            }
        }
    }
    return lines;
}

export function setupStdin(fs, code: string) {
    var i = 0;
    fs.init(
        function () {
            return i < code.length ? code.charCodeAt(i++) : null;
        }
    );
}

function makeCPPSafe(s: string): string {
    return s.replace(/[^A-Za-z0-9_]/g, '_');
}

export function preprocessMCPP(step: BuildStep, filesys: string) {
    load("mcpp");

    var platform = step.platform;
    var params = PLATFORM_PARAMS['zx'];

    if (!params) {
        throw Error("Platform not supported: " + platform);
    }

    // <stdin>:2: error: Can't open include file "foo.h"
    var errors = [];
    var match_fn = makeErrorMatcher(errors, /<stdin>:(\d+): (.+)/, 1, 2, step.path);
    var MCPP: EmscriptenModule = emglobal.mcpp({
        noInitialRun: true,
        noFSInit: true,
        print: print_fn,
        printErr: match_fn,
    });

    var FS = MCPP.FS;

    if (filesys) {
        setupFS(FS, filesys);
    }

    populateFiles(step, FS);

    var args = [
        "-D", "__8BITWORKSHOP__",
        "-D", "__SDCC_z80",
        "-D", makeCPPSafe(platform.toUpperCase()),
        "-I", "/share/include",
        "-Q",
        step.path, "main.i"];

    if (step.mainfile) {
        args.unshift.apply(args, ["-D", "__MAIN__"]);
    }

    execMain(step, MCPP, args);

    if (errors.length) {
        return {errors: errors};
    }

    var iout = FS.readFile("main.i", {encoding: 'utf8'});
    iout = iout.replace(/^#line /gm, '\n# ');

    try {
        var errout = FS.readFile("mcpp.err", {encoding: 'utf8'});
        if (errout.length) {

            // //main.c:2: error: Can't open include file "stdiosd.h"
            var errors = extractErrors(/([^:]+):(\d+): (.+)/, errout.split("\n"), step.path, 2, 3, 1);

            if (errors.length == 0) {
                errors = errorResult(errout).errors;
            }

            return {errors: errors};
        }
    } catch (e) {
        console.error(e);
    }

    return {code: iout};
}

async function handleMessage(data: WorkerMessage): Promise<WorkerResult> {

    // preload file system
    if (data.preload) {
        var fs = TOOL_PRELOADFS[data.preload];

        if (!fs && data.platform) {
            fs = TOOL_PRELOADFS[data.preload + '-zx'];
        }

        if (!fs && data.platform) {
            fs = TOOL_PRELOADFS[data.preload + '-zx'];
        }

        if (fs && !fsMeta[fs]) {
            loadFilesystem(fs);
        }

        return;
    }

    // clear filesystem?
    if (data.reset) {
        store.reset();
        return;
    }

    return builder.handleMessage(data);
}

var lastpromise = null;

onmessage = async function (e) {
    await lastpromise; // wait for previous message to complete
    lastpromise = handleMessage(e.data);
    var result = await lastpromise;
    lastpromise = null;

    if (result) {
        try {
            postMessage(result);
        } catch (e) {
            console.log(e);
            postMessage(errorResult(`${e}`));
        }
    }
}
