import type {
    WorkerResult,
    WorkerBuildStep,
    WorkerMessage,
    WorkerError,
    SourceLine,
    WorkerErrorResult,
    WorkingStore
} from "./types";
import {getBasePlatform, getRootBasePlatform} from "../util";
import * as sdcc from './sdcc'
import * as z80 from './z80'

/// <reference types="emscripten" />
export interface EmscriptenModule {
    callMain: (args: string[]) => void;
    FS: any;
}

declare function importScripts(path: string);

declare function postMessage(msg);

const ENVIRONMENT_IS_WEB = typeof window === 'object';
const ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';

export const emglobal: any = ENVIRONMENT_IS_WORKER ? self : ENVIRONMENT_IS_WEB ? window : global;

// simple CommonJS module loader
if (!emglobal['require']) {
    emglobal['require'] = (modpath: string) => {
        if (modpath.endsWith('.js')) {
            modpath = modpath.slice(-3);
        }

        var modname = modpath.split('/').slice(-1)[0];
        var hasNamespace = emglobal[modname] != null;
        console.log('@@@ require', modname, modpath, hasNamespace);

        if (!hasNamespace) {
            exports = {};
            importScripts(`${modpath}.js`);
        }

        if (emglobal[modname] == null) {
            emglobal[modname] = exports;
        }

        return emglobal[modname];
    }
}

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

var PLATFORM_PARAMS = {
    'zx': {
        arch: 'z80',
        code_start: 0x5ccb,
        rom_size: 0xff58 - 0x5ccb,
        data_start: 0xf000,
        data_size: 0xfe00 - 0xf000,
        stack_end: 0xff58,
        extra_link_args: ['crt0-zx.rel'],
        extra_link_files: ['crt0-zx.rel', 'crt0-zx.lst'],
    },
};

PLATFORM_PARAMS['sms-sms-libcv'] = PLATFORM_PARAMS['sms-sg1000-libcv'];

var _t1;

export function starttime() {
    _t1 = new Date();
}

export function endtime(msg) {
    var _t2 = new Date();
    console.log(msg, _t2.getTime() - _t1.getTime(), "ms");
}

/// working file store and build steps

type FileData = string | Uint8Array;

type FileEntry = {
    path: string
    encoding: string
    data: FileData
    ts: number
};

type BuildOptions = {
    mainFilePath: string,
    processFn?: (s: string, d: FileData) => FileData
};

export type BuildStepResult = WorkerResult | WorkerNextToolResult;

export interface WorkerNextToolResult {
    nexttool?: string
    linktool?: string
    path?: string
    args: string[]
    files: string[]
    bblines?: boolean
}

export interface BuildStep extends WorkerBuildStep {
    files?: string[]
    args?: string[]
    nextstep?: BuildStep
    linkstep?: BuildStep
    params?
    result?: BuildStepResult
    code?
    prefix?
    maxts?
}

export class FileWorkingStore implements WorkingStore {
    workfs: { [path: string]: FileEntry } = {};
    workerseq: number = 0;
    items: {};

    constructor() {
        this.reset();
    }

    reset() {
        this.workfs = {};
        this.newVersion();
    }

    currentVersion() {
        return this.workerseq;
    }

    newVersion() {
        let ts = new Date().getTime();
        if (ts <= this.workerseq)
            ts = ++this.workerseq;
        return ts;
    }

    putFile(path: string, data: FileData): FileEntry {
        var encoding = (typeof data === 'string') ? 'utf8' : 'binary';
        var entry = this.workfs[path];

        if (!entry || !compareData(entry.data, data) || entry.encoding != encoding) {
            this.workfs[path] = entry = {
                path: path,
                data: data,
                encoding: encoding,
                ts: this.newVersion()
            };

            console.log('+++', entry.path, entry.encoding, entry.data.length, entry.ts);
        }

        return entry;
    }

    getFileData(path: string): FileData {
        return this.workfs[path] && this.workfs[path].data;
    }

    getFileAsString(path: string): string {
        let data = this.getFileData(path);
        if (data != null && typeof data !== 'string') {
            throw new Error(`${path}: expected string`)
        }

        return data as string;
    }

    setItem(key: string, value: object) {
        this.items[key] = value;
    }
}

export var store = new FileWorkingStore();

function errorResult(msg: string): WorkerErrorResult {
    return {errors: [{line: 0, msg: msg}]};
}

class Builder {
    steps: BuildStep[] = [];
    startseq: number = 0;

    async executeBuildSteps(): Promise<WorkerResult> {
        this.startseq = store.currentVersion();
        var linkstep: BuildStep = null;

        while (this.steps.length) {
            var step = this.steps.shift(); // get top of array
            var platform = step.platform;
            var toolfn = TOOLS[step.tool];

            if (!toolfn) {
                throw Error("no tool named " + step.tool);
            }

            step.params = PLATFORM_PARAMS[getBasePlatform(platform)];

            try {
                step.result = await toolfn(step);
            } catch (e) {
                console.log("EXCEPTION", e, e.stack);
                return errorResult(e + "");
            }

            if (step.result) {
                (step.result as any).params = step.params;

                // errors? return them
                if ('errors' in step.result && step.result.errors.length) {
                    applyDefaultErrorPath(step.result.errors, step.path);
                    return step.result;
                }

                // if we got some output, return it immediately
                if ('output' in step.result && step.result.output) {
                    return step.result;
                }

                // combine files with a link tool?
                if ('linktool' in step.result) {
                    if (linkstep) {
                        linkstep.files = linkstep.files.concat(step.result.files);
                        linkstep.args = linkstep.args.concat(step.result.args);
                    } else {
                        linkstep = {
                            tool: step.result.linktool,
                            platform: platform,
                            files: step.result.files,
                            args: step.result.args
                        };
                    }
                }

                // process with another tool?
                if ('nexttool' in step.result) {
                    var asmstep: BuildStep = {
                        tool: step.result.nexttool,
                        platform: platform,
                        ...step.result
                    }

                    this.steps.push(asmstep);
                }

                // process final step?
                if (this.steps.length == 0 && linkstep) {
                    this.steps.push(linkstep);
                    linkstep = null;
                }
            }
        }
    }

    async handleMessage(data: WorkerMessage): Promise<WorkerResult> {
        this.steps = [];

        // file updates
        if (data.updates) {
            data.updates.forEach((u) => store.putFile(u.path, u.data));
        }

        // object update
        if (data.setitems) {
            data.setitems.forEach((i) => store.setItem(i.key, i.value));
        }

        // build steps
        if (data.buildsteps) {
            this.steps.push.apply(this.steps, data.buildsteps);
        }

        // single-file
        if (data.code) {
            this.steps.push(data as BuildStep);
        }

        // execute build steps
        if (this.steps.length) {
            var result = await this.executeBuildSteps();
            return result ? result : {unchanged: true};
        }

        // message not recognized
        console.log("Unknown message", data);
    }
}

var builder = new Builder();

function applyDefaultErrorPath(errors: WorkerError[], path: string) {
    if (!path) {
        return;
    }

    for (var i = 0; i < errors.length; i++) {
        var err = errors[i];
        if (!err.path && err.line) {
            err.path = path;
        }
    }
}

function compareData(a: FileData, b: FileData): boolean {
    if (a.length != b.length) {
        return false;
    }

    if (typeof a === 'string' && typeof b === 'string') {
        return a == b;
    } else {
        for (var i = 0; i < a.length; i++) {
            if (a[i] != b[i]) return false;
        }

        return true;
    }
}

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
            var xpath = getBasePlatform(step.platform) + "/" + xfn;
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
    var params = PLATFORM_PARAMS[getBasePlatform(platform)];

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
    populateExtraFiles(step, FS, params.extra_compile_files);

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

    if (params.extra_preproc_args) {
        args.push.apply(args, params.extra_preproc_args);
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

var TOOLS = {
    'sdasz80': sdcc.assembleSDASZ80,
    'sdldz80': sdcc.linkSDLDZ80,
    'sdcc': sdcc.compileSDCC,
    'zmac': z80.assembleZMAC,
}

var TOOL_PRELOADFS = {
    'sdasz80': 'sdcc',
    'sdcc': 'sdcc',
}

async function handleMessage(data: WorkerMessage): Promise<WorkerResult> {

    // preload file system
    if (data.preload) {
        var fs = TOOL_PRELOADFS[data.preload];

        if (!fs && data.platform) {
            fs = TOOL_PRELOADFS[data.preload + '-' + getBasePlatform(data.platform)];
        }

        if (!fs && data.platform) {
            fs = TOOL_PRELOADFS[data.preload + '-' + getRootBasePlatform(data.platform)];
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

if (ENVIRONMENT_IS_WORKER) {
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
}
