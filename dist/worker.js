"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // src/worker/shared_vars.ts
  var ENVIRONMENT_IS_WEB = typeof window === "object";
  var ENVIRONMENT_IS_WORKER = typeof importScripts === "function";
  var emglobal = ENVIRONMENT_IS_WORKER ? self : ENVIRONMENT_IS_WEB ? window : global;
  var WORKER_RELATIVE_PATH = "../8bitworker/";

  // src/worker/FileWorkingStore.ts
  var FileWorkingStore = class {
    constructor() {
      this.workfs = {};
      this.workerseq = 0;
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
      if (ts <= this.workerseq) {
        ts = ++this.workerseq;
      }
      return ts;
    }
    putFile(path, data) {
      const encoding = typeof data === "string" ? "utf8" : "binary";
      let entry = this.workfs[path];
      if (!entry || !compareData(entry.data, data) || entry.encoding != encoding) {
        this.workfs[path] = entry = {
          path,
          data,
          encoding,
          ts: this.newVersion()
        };
        console.log("+++", entry.path, entry.encoding, entry.data.length, entry.ts);
      }
      return entry;
    }
    getFileData(path) {
      return this.workfs[path] && this.workfs[path].data;
    }
    getFileAsString(path) {
      let data = this.getFileData(path);
      if (data != null && typeof data !== "string") {
        throw new Error(`${path}: expected string`);
      }
      return data;
    }
    setItem(key, value) {
      this.items[key] = value;
    }
  };
  function compareData(a, b) {
    if (a.length != b.length) {
      return false;
    }
    if (typeof a === "string" && typeof b === "string") {
      return a == b;
    } else {
      for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i])
          return false;
      }
      return true;
    }
  }

  // src/worker/files.ts
  var fsMeta = {};
  var fsBlob = {};
  var fileStore = new FileWorkingStore();
  function loadFilesystem(name) {
    let xhr = new XMLHttpRequest();
    xhr.responseType = "blob";
    xhr.open("GET", WORKER_RELATIVE_PATH + "fs/fs" + name + ".data", false);
    xhr.send(null);
    fsBlob[name] = xhr.response;
    xhr = new XMLHttpRequest();
    xhr.responseType = "json";
    xhr.open("GET", WORKER_RELATIVE_PATH + "fs/fs" + name + ".js.metadata", false);
    xhr.send(null);
    fsMeta[name] = xhr.response;
    console.log("Loaded " + name + " filesystem", fsMeta[name].files.length, "files", fsBlob[name].size, "bytes");
  }
  function fsLoaded(name) {
    return fsMeta.hasOwnProperty(name);
  }
  function setupFS(FS, name) {
    const WORKERFS = FS.filesystems["WORKERFS"];
    if (!fsMeta[name]) {
      throw Error("No filesystem for '" + name + "'");
    }
    FS.mkdir("/share");
    FS.mount(WORKERFS, {
      packages: [{ metadata: fsMeta[name], blob: fsBlob[name] }]
    }, "/share");
    const reader = WORKERFS.reader;
    const blobcache = {};
    WORKERFS.stream_ops.read = function(stream, buffer, offset, length, position) {
      if (position >= stream.node.size) {
        return 0;
      }
      let contents = blobcache[stream.path];
      if (!contents) {
        const ab = reader.readAsArrayBuffer(stream.node.contents);
        contents = blobcache[stream.path] = new Uint8Array(ab);
      }
      if (position + length > contents.length) {
        length = contents.length - position;
      }
      for (let i = 0; i < length; i++) {
        buffer[offset + i] = contents[position + i];
      }
      return length;
    };
  }
  function putWorkFile(path, data) {
    return fileStore.putFile(path, data);
  }
  function getWorkFileAsString(path) {
    return fileStore.getFileAsString(path);
  }
  function populateEntry(fs, path, entry) {
    let data = entry.data;
    const toks = path.split("/");
    if (toks.length > 1) {
      for (let i = 0; i < toks.length - 1; i++) {
        try {
          fs.mkdir(toks[i]);
        } catch (e) {
          console.log(e);
        }
      }
    }
    fs.writeFile(path, data, { encoding: entry.encoding });
    const time = new Date(entry.ts).getTime();
    fs.utime(path, time, time);
    console.log("<<<", path, entry.data.length);
  }
  function gatherFiles(step) {
    let maxts = 0;
    if (step.files) {
      for (let i = 0; i < step.files.length; i++) {
        const path = step.files[i];
        const entry = fileStore.workfs[path];
        if (!entry) {
          throw new Error("No entry for path '" + path + "'");
        } else {
          maxts = Math.max(maxts, entry.ts);
        }
      }
    } else if (step.path) {
      const path = step.path;
      const entry = fileStore.workfs[path];
      maxts = entry.ts;
      step.files = [path];
    }
    if (step.path && !step.prefix) {
      step.prefix = getPrefix(step.path);
    }
    step.maxts = maxts;
    return maxts;
  }
  function getPrefix(s) {
    const pos = s.lastIndexOf(".");
    return pos > 0 ? s.substring(0, pos) : s;
  }
  function populateFiles(step, fs) {
    gatherFiles(step);
    if (!step.files) {
      throw Error("call gatherFiles() first");
    }
    for (let i = 0; i < step.files.length; i++) {
      const path = step.files[i];
      populateEntry(fs, path, fileStore.workfs[path]);
    }
  }
  function populateExtraFiles(step, fs, extrafiles) {
    if (extrafiles) {
      for (let i = 0; i < extrafiles.length; i++) {
        const xfn = extrafiles[i];
        if (fileStore.workfs[xfn]) {
          fs.writeFile(xfn, fileStore.workfs[xfn].data, { encoding: "binary" });
          continue;
        }
        const xpath = "zx/" + xfn;
        const xhr = new XMLHttpRequest();
        xhr.responseType = "arraybuffer";
        xhr.open("GET", WORKER_RELATIVE_PATH + xpath, false);
        xhr.send(null);
        if (xhr.response && xhr.status == 200) {
          const data = new Uint8Array(xhr.response);
          fs.writeFile(xfn, data, { encoding: "binary" });
          putWorkFile(xfn, data);
          console.log(":::", xfn, data.length);
        } else {
          throw Error("Could not load extra file " + xpath);
        }
      }
    }
  }
  function staleFiles(step, targets) {
    if (!step.maxts) {
      throw Error("call populateFiles() first");
    }
    for (let i = 0; i < targets.length; i++) {
      const entry = fileStore.workfs[targets[i]];
      if (!entry || step.maxts > entry.ts) {
        return true;
      }
    }
    console.log("unchanged", step.maxts, targets);
    return false;
  }
  function anyTargetChanged(step, targets) {
    if (!step.maxts) {
      throw Error("call populateFiles() first");
    }
    for (let i = 0; i < targets.length; i++) {
      const entry = fileStore.workfs[targets[i]];
      if (!entry || entry.ts > step.maxts) {
        return true;
      }
    }
    console.log("unchanged", step.maxts, targets);
    return false;
  }

  // src/worker/shared_funcs.ts
  function errorResult(msg) {
    return { errors: [{ line: 0, msg }] };
  }
  function print_fn(s) {
    console.log(s);
  }
  function makeErrorMatcher(errors, regex, iline, imsg, mainpath, ifilename) {
    return function(s) {
      const matches = regex.exec(s);
      if (matches) {
        errors.push({
          line: parseInt(matches[iline]) || 1,
          msg: matches[imsg],
          path: ifilename ? matches[ifilename] : mainpath
        });
      } else {
        console.log("??? " + s);
      }
    };
  }

  // src/worker/modules.ts
  var wasmModuleCache = {};
  var wasmBlob = {};
  var loaded = {};
  function getWASMModule(module_id) {
    let module = wasmModuleCache[module_id];
    if (!module) {
      module = new WebAssembly.Module(wasmBlob[module_id]);
      wasmModuleCache[module_id] = module;
      delete wasmBlob[module_id];
    }
    return module;
  }
  function instantiateWASM(module_id) {
    return function(imports, ri) {
      const mod = getWASMModule(module_id);
      const inst = new WebAssembly.Instance(mod, imports);
      ri(inst);
      return inst.exports;
    };
  }
  function loadWASM(modulename, debug) {
    if (!loaded[modulename]) {
      importScripts(WORKER_RELATIVE_PATH + "wasm/" + modulename + (debug ? "." + debug + ".js" : ".js"));
      const xhr = new XMLHttpRequest();
      xhr.responseType = "arraybuffer";
      xhr.open("GET", WORKER_RELATIVE_PATH + "wasm/" + modulename + ".wasm", false);
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
  function loadASMJS(modulename, debug) {
    if (!loaded[modulename]) {
      importScripts(WORKER_RELATIVE_PATH + "asmjs/" + modulename + (debug ? "." + debug + ".js" : ".js"));
      loaded[modulename] = 1;
    }
  }

  // src/worker/tools/mcpp.ts
  function preprocessMCPP(step, filesys) {
    loadASMJS("mcpp");
    let errors = [];
    const match_fn = makeErrorMatcher(errors, /<stdin>:(\d+): (.+)/, 1, 2, step.path);
    const MCPP = emglobal.mcpp({
      noInitialRun: true,
      noFSInit: true,
      print: print_fn,
      printErr: match_fn
    });
    const FS = MCPP.FS;
    if (filesys) {
      setupFS(FS, filesys);
    }
    populateFiles(step, FS);
    const args = [
      "-D",
      "__8BITWORKSHOP__",
      "-D",
      "__SDCC_z80",
      "-D",
      "ZX",
      "-I",
      "/share/include",
      "-Q",
      step.path,
      "main.i"
    ];
    if (step.mainfile) {
      args.unshift.apply(args, ["-D", "__MAIN__"]);
    }
    MCPP.callMain(args);
    if (errors.length) {
      return { errors };
    }
    let iout = FS.readFile("main.i", { encoding: "utf8" });
    iout = iout.replace(/^#line /gm, "\n# ");
    try {
      const errout = FS.readFile("mcpp.err", { encoding: "utf8" });
      if (errout.length) {
        errors = extractErrors(/([^:]+):(\d+): (.+)/, errout.split("\n"), step.path, 2, 3, 1);
        if (errors.length == 0) {
          errors = errorResult(errout).errors;
        }
        return { errors };
      }
    } catch (e) {
      console.error(e);
    }
    return { code: iout };
  }
  function extractErrors(regex, strings, path, iline, imsg, ifilename) {
    const errors = [];
    const matcher = makeErrorMatcher(errors, regex, iline, imsg, path, ifilename);
    for (let i = 0; i < strings.length; i++) {
      matcher(strings[i]);
    }
    return errors;
  }

  // src/worker/parsing.ts
  var re_crlf = /\r?\n/;
  var re_lineoffset = /\s*(\d+)\s+[%]line\s+(\d+)\+(\d+)\s+(.+)/;
  function parseListing(code, lineMatch, iline, ioffset, iinsns, icycles, funcMatch, segMatch) {
    const lines = [];
    let lineofs = 0;
    let segment = "";
    let func = "";
    let funcbase = 0;
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
      const linem = lineMatch.exec(line);
      if (linem && linem[1]) {
        const linenum = iline < 0 ? lineindex : parseInt(linem[iline]);
        const offset = parseInt(linem[ioffset], 16);
        const insns = linem[iinsns];
        const cycles = icycles ? parseInt(linem[icycles]) : null;
        const iscode = cycles > 0;
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
  function parseSourceLines(code, lineMatch, offsetMatch, funcMatch, segMatch) {
    const lines = [];
    let lastlinenum = 0;
    let segment = "";
    let func = "";
    let funcbase = 0;
    for (let line of code.split(re_crlf)) {
      let segm = segMatch && segMatch.exec(line);
      if (segm) {
        segment = segm[1];
      }
      let funcm = funcMatch && funcMatch.exec(line);
      if (funcm) {
        funcbase = parseInt(funcm[1], 16);
        func = funcm[2];
      }
      let linem = lineMatch.exec(line);
      if (linem && linem[1]) {
        lastlinenum = parseInt(linem[1]);
      } else if (lastlinenum) {
        linem = offsetMatch.exec(line);
        if (linem && linem[1]) {
          const offset = parseInt(linem[1], 16);
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

  // src/worker/tools/sdcc.ts
  function hexToArray(s, ofs) {
    const buf = new ArrayBuffer(s.length / 2);
    const arr = new Uint8Array(buf);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(s.slice(i * 2 + ofs, i * 2 + ofs + 2), 16);
    }
    return arr;
  }
  function parseIHX(ihx, rom_start, rom_size) {
    const output = new Uint8Array(new ArrayBuffer(rom_size));
    let high_size = 0;
    for (let s of ihx.split("\n")) {
      if (s[0] == ":") {
        const arr = hexToArray(s, 1);
        const count = arr[0];
        const address = (arr[1] << 8) + arr[2] - rom_start;
        const rectype = arr[3];
        if (rectype == 0) {
          let i;
          for (i = 0; i < count; i++) {
            output[i + address] = arr[4 + i];
          }
          if (i + address > high_size) {
            high_size = i + address;
          }
        } else if (rectype == 1) {
          break;
        } else {
          console.log(s);
        }
      }
    }
    return output;
  }
  function assembleSDASZ80(step) {
    loadWASM("sdasz80");
    let objout, lstout;
    const errors = [];
    gatherFiles(step);
    const objpath = step.prefix + ".rel";
    const lstpath = step.prefix + ".lst";
    if (staleFiles(step, [objpath, lstpath])) {
      const match_asm_re1 = / in line (\d+) of (\S+)/;
      const match_asm_re2 = / <\w> (.+)/;
      let errline = 0;
      let errpath = step.path;
      const match_asm_fn = (s) => {
        let m = match_asm_re1.exec(s);
        if (m) {
          errline = parseInt(m[1]);
          errpath = m[2];
        } else {
          m = match_asm_re2.exec(s);
          if (m) {
            errors.push({
              line: errline,
              path: errpath,
              msg: m[1]
            });
          }
        }
      };
      const ASZ80 = emglobal.sdasz80({
        instantiateWasm: instantiateWASM("sdasz80"),
        noInitialRun: true,
        print: match_asm_fn,
        printErr: match_asm_fn
      });
      const FS = ASZ80.FS;
      populateFiles(step, FS);
      ASZ80.callMain(["-plosgffwy", step.path]);
      if (errors.length) {
        return { errors };
      }
      objout = FS.readFile(objpath, { encoding: "utf8" });
      lstout = FS.readFile(lstpath, { encoding: "utf8" });
      putWorkFile(objpath, objout);
      putWorkFile(lstpath, lstout);
    }
    return {
      linktool: "sdldz80",
      files: [objpath, lstpath],
      args: [objpath]
    };
  }
  function linkSDLDZ80(step) {
    loadWASM("sdldz80");
    const errors = [];
    gatherFiles(step);
    const binpath = "main.ihx";
    if (staleFiles(step, [binpath])) {
      const match_aslink_re = /\?ASlink-(\w+)-(.+)/;
      const match_aslink_fn = (s) => {
        const matches = match_aslink_re.exec(s);
        if (matches) {
          errors.push({
            line: 0,
            msg: matches[2]
          });
        }
      };
      const params = step.params;
      const LDZ80 = emglobal.sdldz80({
        instantiateWasm: instantiateWASM("sdldz80"),
        noInitialRun: true,
        print: match_aslink_fn,
        printErr: match_aslink_fn
      });
      const FS = LDZ80.FS;
      setupFS(FS, "sdcc");
      populateFiles(step, FS);
      populateExtraFiles(step, FS, params.extra_link_files);
      const args = [
        "-mjwxyu",
        "-i",
        "main.ihx",
        "-b",
        "_CODE=0x" + params.code_start.toString(16),
        "-b",
        "_DATA=0x" + params.data_start.toString(16),
        "-k",
        "/share/lib/z80",
        "-l",
        "z80"
      ];
      if (params.extra_link_args) {
        args.push.apply(args, params.extra_link_args);
      }
      args.push.apply(args, step.args);
      LDZ80.callMain(args);
      if (errors.length) {
        return { errors };
      }
      const hexout = FS.readFile("main.ihx", { encoding: "utf8" });
      const noiout = FS.readFile("main.noi", { encoding: "utf8" });
      putWorkFile("main.ihx", hexout);
      putWorkFile("main.noi", noiout);
      if (!anyTargetChanged(step, ["main.ihx", "main.noi"])) {
        return;
      }
      const binout = parseIHX(
        hexout,
        params.code_start,
        params.rom_size
      );
      const listings = {};
      for (let fn of step.files) {
        if (fn.endsWith(".lst")) {
          const rstout = FS.readFile(fn.replace(".lst", ".rst"), { encoding: "utf8" });
          const asmlines = parseListing(rstout, /^\s*([0-9A-F]{4})\s+([0-9A-F][0-9A-F r]*[0-9A-F])\s+\[([0-9 ]+)\]?\s+(\d+) (.*)/i, 4, 1, 2, 3);
          const srclines = parseSourceLines(rstout, /^\s+\d+ ;<stdin>:(\d+):/i, /^\s*([0-9A-F]{4})/i);
          putWorkFile(fn, rstout);
          listings[fn] = {
            asmlines: srclines.length ? asmlines : null,
            lines: srclines.length ? srclines : asmlines,
            text: rstout
          };
        }
      }
      const symbolmap = {};
      for (let s of noiout.split("\n")) {
        const toks = s.split(" ");
        if (toks[0] == "DEF" && !toks[1].startsWith("A$")) {
          symbolmap[toks[1]] = parseInt(toks[2], 16);
        }
      }
      const seg_re = /^s__(\w+)$/;
      const segments = [];
      for (let ident in symbolmap) {
        let m = seg_re.exec(ident);
        if (m) {
          let seg = m[1];
          let segstart = symbolmap[ident];
          let segsize = symbolmap["l__" + seg];
          if (segstart >= 0 && segsize > 0) {
            let type = null;
            if (["INITIALIZER", "GSINIT", "GSFINAL"].includes(seg)) {
              type = "rom";
            } else if (seg.startsWith("CODE")) {
              type = "rom";
            } else if (["DATA", "INITIALIZED"].includes(seg)) {
              type = "ram";
            }
            if (type == "rom" || segstart > 0) {
              segments.push({
                name: seg,
                start: segstart,
                size: segsize,
                type
              });
            }
          }
        }
      }
      return {
        output: binout,
        listings,
        errors,
        symbolmap,
        segments
      };
    }
  }
  function compileSDCC(step) {
    gatherFiles(step);
    const outpath = step.prefix + ".asm";
    if (staleFiles(step, [outpath])) {
      const errors = [];
      loadWASM("sdcc");
      const SDCC = emglobal.sdcc({
        instantiateWasm: instantiateWASM("sdcc"),
        noInitialRun: true,
        noFSInit: true,
        print: print_fn,
        printErr: msvcErrorMatcher(errors)
      });
      const FS = SDCC.FS;
      populateFiles(step, FS);
      let code = getWorkFileAsString(step.path);
      const preproc = preprocessMCPP(step, "sdcc");
      if (preproc.errors) {
        return { errors: preproc.errors };
      } else {
        code = preproc.code;
      }
      setupStdin(FS, code);
      setupFS(FS, "sdcc");
      const args = [
        "--vc",
        "--std-sdcc99",
        "-mz80",
        "--c1mode",
        "--less-pedantic",
        "-o",
        outpath
      ];
      if (!/^\s*#pragma\s+opt_code/m.exec(code)) {
        args.push.apply(args, [
          "--oldralloc",
          "--no-peep",
          "--nolospre"
        ]);
      }
      SDCC.callMain(args);
      if (errors.length) {
        return { errors };
      }
      const asmout = " .area _HOME\n .area _CODE\n .area _INITIALIZER\n .area _DATA\n .area _INITIALIZED\n .area _BSEG\n .area _BSS\n .area _HEAP\n" + FS.readFile(outpath, { encoding: "utf8" });
      putWorkFile(outpath, asmout);
    }
    return {
      nexttool: "sdasz80",
      path: outpath,
      args: [outpath],
      files: [outpath]
    };
  }
  function setupStdin(fs, code) {
    let i = 0;
    fs.init(
      function() {
        return i < code.length ? code.charCodeAt(i++) : null;
      }
    );
  }
  var re_msvc = /[/]*([^( ]+)\s*[(](\d+)[)]\s*:\s*(.+?):\s*(.*)/;
  var re_msvc2 = /\s*(at)\s+(\d+)\s*(:)\s*(.*)/;
  function msvcErrorMatcher(errors) {
    return function(s) {
      const matches = re_msvc.exec(s) || re_msvc2.exec(s);
      if (matches) {
        const errline = parseInt(matches[2]);
        errors.push({
          line: errline,
          path: matches[1],
          msg: matches[4]
        });
      } else {
        console.log(s);
      }
    };
  }

  // src/worker/tools/z80.ts
  function assembleZMAC(step) {
    loadWASM("zmac");
    let lstout, binout;
    const errors = [];
    gatherFiles(step);
    const lstpath = step.prefix + ".lst";
    const binpath = step.prefix + ".cim";
    if (staleFiles(step, [binpath, lstpath])) {
      const ZMAC = emglobal.zmac({
        instantiateWasm: instantiateWASM("zmac"),
        noInitialRun: true,
        print: print_fn,
        printErr: makeErrorMatcher(errors, /([^( ]+)\s*[(](\d+)[)]\s*:\s*(.+)/, 2, 3, step.path)
      });
      const FS = ZMAC.FS;
      populateFiles(step, FS);
      ZMAC.callMain(["-z", "-c", "--oo", "lst,cim", step.path]);
      if (errors.length) {
        return { errors };
      }
      lstout = FS.readFile("zout/" + lstpath, { encoding: "utf8" });
      binout = FS.readFile("zout/" + binpath, { encoding: "binary" });
      putWorkFile(binpath, binout);
      putWorkFile(lstpath, lstout);
      if (!anyTargetChanged(step, [binpath, lstpath])) {
        return;
      }
      const lines = parseListing(lstout, /\s*(\d+):\s*([0-9a-f]+)\s+([0-9a-f]+)\s+(.+)/i, 1, 2, 3);
      const listings = {};
      listings[lstpath] = { lines };
      const symbolmap = {};
      const sympos = lstout.indexOf("Symbol Table:");
      if (sympos > 0) {
        const symout = lstout.slice(sympos + 14);
        symout.split("\n").forEach(function(l) {
          const m = l.match(/(\S+)\s+([= ]*)([0-9a-f]+)/i);
          if (m) {
            symbolmap[m[1]] = parseInt(m[3], 16);
          }
        });
      }
      return {
        output: binout,
        listings,
        errors,
        symbolmap
      };
    }
  }

  // src/worker/Builder.ts
  var TOOLS = {
    "sdasz80": assembleSDASZ80,
    "sdldz80": linkSDLDZ80,
    "sdcc": compileSDCC,
    "zmac": assembleZMAC
  };
  var PLATFORM_PARAMS = {
    arch: "z80",
    code_start: 32768,
    rom_size: 65368 - 32768,
    data_start: 61440,
    data_size: 65024 - 61440,
    stack_end: 65368,
    extra_link_args: ["crt0.rel"],
    extra_link_files: ["crt0.rel", "crt0.lst"]
  };
  var Builder = class {
    constructor() {
      this.steps = [];
      this.startseq = 0;
    }
    async executeBuildSteps() {
      this.startseq = fileStore.currentVersion();
      let linkstep = null;
      while (this.steps.length) {
        const step = this.steps.shift();
        const toolfn = TOOLS[step.tool];
        if (!toolfn) {
          throw Error("no tool named " + step.tool);
        }
        step.params = PLATFORM_PARAMS;
        try {
          step.result = await toolfn(step);
        } catch (e) {
          console.log("EXCEPTION", e, e.stack);
          return errorResult(`${e}`);
        }
        if (step.result) {
          step.result.params = step.params;
          if ("errors" in step.result && step.result.errors.length) {
            applyDefaultErrorPath(step.result.errors, step.path);
            return step.result;
          }
          if ("output" in step.result && step.result.output) {
            return step.result;
          }
          if ("linktool" in step.result) {
            if (linkstep) {
              linkstep.files = linkstep.files.concat(step.result.files);
              linkstep.args = linkstep.args.concat(step.result.args);
            } else {
              linkstep = {
                tool: step.result.linktool,
                files: step.result.files,
                args: step.result.args
              };
            }
          }
          if ("nexttool" in step.result) {
            const asmstep = __spreadValues({
              tool: step.result.nexttool
            }, step.result);
            this.steps.push(asmstep);
          }
          if (this.steps.length == 0 && linkstep) {
            this.steps.push(linkstep);
            linkstep = null;
          }
        }
      }
    }
    async handleMessage(data) {
      this.steps = [];
      if (data.updates) {
        data.updates.forEach((u) => fileStore.putFile(u.path, u.data));
      }
      if (data.setitems) {
        data.setitems.forEach((i) => fileStore.setItem(i.key, i.value));
      }
      if (data.buildsteps) {
        this.steps.push.apply(this.steps, data.buildsteps);
      }
      if (this.steps.length) {
        const result = await this.executeBuildSteps();
        return result ? result : { unchanged: true };
      }
      console.log("Unknown message", data);
    }
  };
  function applyDefaultErrorPath(errors, path) {
    if (!path) {
      return;
    }
    for (let i = 0; i < errors.length; i++) {
      const err = errors[i];
      if (!err.path && err.line) {
        err.path = path;
      }
    }
  }

  // src/worker/worker.ts
  var TOOL_PRELOADFS = {
    "sdasz80": "sdcc",
    "sdcc": "sdcc"
  };
  var builder = new Builder();
  async function handleMessage(data) {
    if (data.preload) {
      let fs = TOOL_PRELOADFS[data.preload];
      if (fs && !fsLoaded[fs]) {
        loadFilesystem(fs);
      }
      return;
    }
    if (data.reset) {
      fileStore.reset();
      return;
    }
    return builder.handleMessage(data);
  }
  var lastpromise = null;
  onmessage = async function(e) {
    await lastpromise;
    lastpromise = handleMessage(e.data);
    const result = await lastpromise;
    lastpromise = null;
    if (result) {
      try {
        postMessage(result);
      } catch (e2) {
        console.log(e2);
        postMessage(errorResult(`${e2}`));
      }
    }
  };
})();
//# sourceMappingURL=worker.js.map
