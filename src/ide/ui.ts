// 8bitworkshop IDE user interface

import {
  CodeProject,
  createNewPersistentStore,
  LocalForageFilesystem,
  OverlayFilesystem,
  ProjectFilesystem,
  WebPresetsFileSystem
} from "./project";
import {WorkerResult, WorkerError} from "../common/workertypes";
import {ProjectWindows} from "./windows";
import {
  Platform,
  Preset,
  DebugSymbols,
  DebugEvalCondition,
  isDebuggable,
  EmuState
} from "../machine/zx";
import {EmuHalt} from "../common/emu";
import {Toolbar} from "../common/toolbar";
import {
  getFilenameForPath,
  getFilenamePrefix,
  highlightDifferences,
  byteArrayToString,
  compressLZG,
  getBasePlatform,
  getRootBasePlatform,
  hex,
  loadScript,
  decodeQueryString,
  parseBool
} from "../common/util";
import {StateRecorderImpl} from "../common/recorder";
import Split = require('split.js');
import {DisassemblerView, ListingView, SourceEditor} from "./views/editors";
import {
  AddressHeatMapView,
  BinaryFileView,
  MemoryMapView,
  MemoryView,
  ProbeLogView,
  ProbeSymbolView,
  RasterPCHeatMapView,
  ScanlineIOView,
  VRAMMemoryView
} from "./views/debugviews";
import {AssetEditorView} from "./views/asseteditor";
import {isMobileDevice} from "./views/baseviews";
import {CallStackView, DebugBrowserView} from "./views/treeviews";
import {saveAs} from "file-saver";
import {ZXWASMPlatform} from "../machine/zx";

// external libs
declare var GIF;
declare var $ : JQueryStatic; // use browser jquery

// query string
interface UIQueryString {
  platform? : string;
  file? : string;
  options?: string;
  embed? : string;
}

export var qs : UIQueryString = decodeQueryString(window.location.search||'?') as UIQueryString;

const isEmbed = parseBool(qs.embed);

/// GLOBALS

var PRESETS : Preset[];			// presets array

export var platform_id : string;	// platform ID string (platform)
export var store_id : string;		// store ID string (platform)
export var platform : Platform;		// emulator object

var toolbar = $("#controls_top");

var uitoolbar : Toolbar;

export var current_project : CodeProject;	// current CodeProject object

export var projectWindows : ProjectWindows;	// window manager

var stateRecorder : StateRecorderImpl;

var userPaused : boolean;		// did user explicitly pause?

var current_output : any;     // current ROM (or other object)
var current_preset : Preset;	// current preset object (if selected)
var store : LocalForage;			// persistent store

export var compparams;			// received build params from worker
export var lastDebugState : EmuState;	// last debug state (object)

var lastDebugInfo;		// last debug info (CPU text)
var debugCategory;		// current debug category
var debugTickPaused = false;
var recorderActive = false;
var lastViewClicked = null;
var errorWasRuntime = false;
var lastBreakExpr = "c.PC == 0x6000";

// TODO: codemirror multiplex support?
// TODO: move to views.ts?
const TOOL_TO_SOURCE_STYLE = {
  'z80asm': 'z80',
  'sdasz80': 'z80',
  'sdcc': 'text/x-csrc',
  'zmac': 'z80',
}

const TOOL_TO_HELPURL = {
  'sdcc': 'http://sdcc.sourceforge.net/doc/sdccman.pdf',
}

function alertError(s:string) {
  setWaitDialog(false);
  bootbox.alert({
    title: '<span class="glyphicon glyphicon-alert" aria-hidden="true"></span> Alert',
    message: s
  });
}

function alertInfo(s:string) {
  setWaitDialog(false);
  bootbox.alert(s);
}

function fatalError(s:string) {
  alertError(s);
  throw new Error(s);
}

function newWorker() : Worker {
  return new Worker("./dist/worker/bundle.js");
}

function getCurrentPresetTitle() : string {
  if (!current_preset)
    return current_project.mainPath || "ROM";
  else
    return current_preset.title || current_preset.name || current_project.mainPath || "ROM";
}

async function newFilesystem() {
  var basefs : ProjectFilesystem = new WebPresetsFileSystem(platform_id);
  return new OverlayFilesystem(basefs, new LocalForageFilesystem(store));
}

async function initProject() {
  var filesystem = await newFilesystem();
  current_project = new CodeProject(newWorker(), platform_id, platform, filesystem);
  projectWindows = new ProjectWindows($("#workspace")[0] as HTMLElement, current_project);
  current_project.callbackBuildResult = (result:WorkerResult) => {
    setCompileOutput(result);
  };
  current_project.callbackBuildStatus = (busy:boolean) => {
    setBusyStatus(busy);
  };
}

function setBusyStatus(busy: boolean) {
  if (busy) {
    toolbar.addClass("is-busy");
  } else {
    toolbar.removeClass("is-busy");
  }
  $('#compile_spinner').css('visibility', busy ? 'visible' : 'hidden');
}

function refreshWindowList() {
  var ul = $("#windowMenuList").empty();
  var separate = false;

  function addWindowItem(id, name, createfn) {
    if (separate) {
      ul.append(document.createElement("hr"));
      separate = false;
    }

    var li = document.createElement("li");
    var a = document.createElement("a");

    a.setAttribute("class", "dropdown-item");
    a.setAttribute("href", "#");

    a.setAttribute("data-wndid", id);
    if (id == projectWindows.getActiveID())
      $(a).addClass("dropdown-item-checked");

    a.appendChild(document.createTextNode(name));
    li.appendChild(a);
    ul.append(li);

    if (createfn) {
      var onopen = (id, wnd) => {
        ul.find('a').removeClass("dropdown-item-checked");
        $(a).addClass("dropdown-item-checked");
      };

      projectWindows.setCreateFunc(id, createfn);
      projectWindows.setShowFunc(id, onopen);

      $(a).click( (e) => {
        projectWindows.createOrShow(id);
        lastViewClicked = id;
      });
    }
  }

  function loadEditor(path:string) {
    var tool = platform.getToolForFilename(path);
    var mode = tool && TOOL_TO_SOURCE_STYLE[tool];
    return new SourceEditor(path, mode);
  }

  function addEditorItem(id:string) {
    addWindowItem(id, getFilenameForPath(id), () => {
      var data = current_project.getFile(id);
      if (typeof data === 'string')
        return loadEditor(id);
      else if (data instanceof Uint8Array)
        return new BinaryFileView(id, data as Uint8Array);
    });
  }

  // add main file editor
  addEditorItem(current_project.mainPath);

  // add other source files
  current_project.iterateFiles( (id, text) => {
    if (text && id != current_project.mainPath) {
      addEditorItem(id);
    }
  });

  // add listings
  separate = true;
  var listings = current_project.getListings();
  if (listings) {
    for (var lstfn in listings) {
      var lst = listings[lstfn];
      // add listing if source/assembly file exists and has text
      if ((lst.assemblyfile && lst.assemblyfile.text) || (lst.sourcefile && lst.sourcefile.text)) {
        addWindowItem(lstfn, getFilenameForPath(lstfn), (path) => {
          return new ListingView(path);
        });
      }
    }
  }

  // add other tools
  separate = true;
  if (platform.disassemble && platform.saveState) {
    addWindowItem("#disasm", "Disassembly", () => {
      return new DisassemblerView();
    });
  }

  if (platform.readAddress) {
    addWindowItem("#memory", "Memory Browser", () => {
      return new MemoryView();
    });
  }

  if (current_project.segments && current_project.segments.length) {
    addWindowItem("#memmap", "Memory Map", () => {
      return new MemoryMapView();
    });
  }

  if (platform.readVRAMAddress) {
    addWindowItem("#memvram", "VRAM Browser", () => {
      return new VRAMMemoryView();
    });
  }

  if (platform.startProbing) {
    addWindowItem("#memheatmap", "Memory Probe", () => {
      return new AddressHeatMapView();
    });

    // TODO: only if raster
    addWindowItem("#crtheatmap", "CRT Probe", () => {
      return new RasterPCHeatMapView();
    });

    addWindowItem("#probelog", "Probe Log", () => {
      return new ProbeLogView();
    });

    addWindowItem("#scanlineio", "Scanline I/O", () => {
      return new ScanlineIOView();
    });

    addWindowItem("#symbolprobe", "Symbol Profiler", () => {
      return new ProbeSymbolView();
    });

    addWindowItem("#callstack", "Call Stack", () => {
      return new CallStackView();
    });

    /*
    addWindowItem("#framecalls", "Frame Profiler", () => {
      return new FrameCallsView();
    });
    */
  }

  if (platform.getDebugTree) {
    addWindowItem("#debugview", "Debug Tree", () => {
      return new DebugBrowserView();
    });
  }

  addWindowItem('#asseteditor', 'Asset Editor', () => {
    return new AssetEditorView();
  });
}

function loadMainWindow(preset_id:string) {
  // we need this to build create functions for the editor
  refreshWindowList();
  // show main file
  projectWindows.createOrShow(preset_id);
  // build project
  current_project.setMainFile(preset_id);
}

async function loadProject(preset_id:string) {
  // set current file ID
  // TODO: this is done twice (mainPath and mainpath!)

  current_project.mainPath = preset_id;

  // load files from storage or web URLs
  var result = await current_project.loadFiles([preset_id]);
  console.assert(result && result.length);

  measureTimeLoad = new Date(); // for timing calc.

  // file found; continue
  loadMainWindow(preset_id);
}

function reloadProject(id:string) {
  qs.platform = platform_id;
  qs.file = id;
  gotoNewLocation();
}

async function getSkeletonFile(fileid:string) : Promise<string> {
  var ext = platform.getToolForFilename(fileid);
  try {
    return await $.get( "presets/"+getBasePlatform(platform_id)+"/skeleton."+ext, 'text');
  } catch(e) {
    alertError("Could not load skeleton for " + platform_id + "/" + ext + "; using blank file");
  }
}

function checkEnteredFilename(fn : string) : boolean {
  if (fn.indexOf(" ") >= 0) {
    alertError("No spaces in filenames, please.");
    return false;
  }
  return true;
}

function getCurrentMainFilename() : string {
  return getFilenameForPath(current_project.mainPath);
}

function getCurrentEditorFilename() : string {
  return getFilenameForPath(projectWindows.getActiveID());
}

function getCookie(name) : string {
    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    for(var i=0;i < ca.length;i++) {
        var c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}

function _shareEmbedLink(e) {
  if (current_output == null) {
    alertError("Please fix errors before sharing.");
    return true;
  }

  if (!(current_output instanceof Uint8Array)) {
    alertError("Can't share a Verilog executable yet. (It's not actually a ROM...)");
    return true;
  }

  loadClipboardLibrary();
  loadScript('dist/liblzg.js').then( () => {
    // TODO: Module is bad var name (conflicts with MAME)
    var lzgrom = compressLZG( window['Module'], Array.from(<Uint8Array>current_output) );
    window['Module'] = null; // so we load it again next time
    var lzgb64 = btoa(byteArrayToString(lzgrom));
    var embed = {
      p: platform_id,
      //n: current_project.mainPath,
      r: lzgb64
    };
    var linkqs = $.param(embed);
    var fulllink = get8bitworkshopLink(linkqs, 'player.html');
    var iframelink = '<iframe width=640 height=600 src="' + fulllink + '">';
    $("#embedLinkTextarea").text(fulllink);
    $("#embedIframeTextarea").text(iframelink);
    $("#embedLinkModal").modal('show');
    $("#embedAdviceWarnAll").hide();
    $("#embedAdviceWarnIE").hide();
    if (fulllink.length >= 65536) $("#embedAdviceWarnAll").show();
    else if (fulllink.length >= 5120) $("#embedAdviceWarnIE").show();
  });

  return true;
}

function loadClipboardLibrary() {
  // can happen in background because it won't be used until user clicks
  console.log('clipboard');
  import('clipboard').then( (clipmod) => {
    let ClipboardJS = clipmod.default;
    new ClipboardJS(".btn");
  });
}

function get8bitworkshopLink(linkqs : string, fn : string) {
  console.log(linkqs);
  var loc = window.location;
  var prefix = loc.pathname.replace('index.html','');
  var protocol = (loc.host == '8bitworkshop.com') ? 'https:' : loc.protocol;
  var fulllink = protocol + '//' + loc.host + prefix + fn + '?' + linkqs;
  return fulllink;
}

function _downloadCassetteFile_apple2(e) {
  var addr = compparams && compparams.code_start;
  loadScript('lib/c2t.js').then( () => {
    var stdout = '';
    var print_fn = function(s) { stdout += s + "\n"; }
    var c2t = window['c2t']({
      noInitialRun:true,
      print:print_fn,
      printErr:print_fn
    });

    var FS = c2t['FS'];
    var rompath = getCurrentMainFilename() + ".bin";
    var audpath = getCurrentMainFilename() + ".wav";
    FS.writeFile(rompath, current_output, {encoding:'binary'});
    var args = ["-2bc", rompath+','+addr.toString(16), audpath];
    c2t.callMain(args);
    var audout = FS.readFile(audpath, {'encoding':'binary'});

    if (audout) {
      var blob = new Blob([audout], {type: "audio/wav"});
      saveAs(blob, audpath);
      stdout += "Then connect your audio output to the cassette input, turn up the volume, and play the audio file.";
      alertInfo('<pre style="white-space: pre-wrap">'+stdout+'</pre>');
    }
  });
}

function _downloadCassetteFile_vcs(e) {
  loadScript('lib/makewav.js').then( () => {
    let stdout = '';
    let print_fn = function(s) { stdout += s + "\n"; }
    var prefix = getFilenamePrefix(getCurrentMainFilename());
    let rompath = prefix + ".bin";
    let audpath = prefix + ".wav";
    let _makewav = window['makewav']({
      noInitialRun:false,
      print:print_fn,
      printErr:print_fn,
      arguments:['-ts', '-f0', '-v10', rompath],
      preRun: (mod) => {
        let FS = mod['FS'];
        FS.writeFile(rompath, current_output, {encoding:'binary'});
      }
    });

    _makewav.ready.then((makewav) => {
      let args = [rompath];
      makewav.run(args);
      console.log(stdout);
      let FS = makewav['FS'];
      let audout = FS.readFile(audpath, {'encoding':'binary'});
      if (audout) {
        let blob = new Blob([audout], {type: "audio/wav"});
        saveAs(blob, audpath);
        stdout += "\nConnect your audio output to the SuperCharger input, turn up the volume, and play the audio file.";
        alertInfo('<pre style="white-space: pre-wrap">'+stdout+'</pre>');
      }
    });
  });
}

function _downloadCassetteFile(e) {
  if (current_output == null) {
    alertError("Please fix errors before exporting.");
    return true;
  }

  var fn;
  switch (getBasePlatform(platform_id)) {
    case 'vcs': fn = _downloadCassetteFile_vcs; break;
    case 'apple2': fn = _downloadCassetteFile_apple2; break;
  }

  if (fn === undefined) {
    alertError("Cassette export is not supported on this platform.");
    return true;
  }

  fn(e);
}

function _downloadROMImage(e) {
  if (current_output == null) {
    alertError("Please finish compiling with no errors before downloading ROM.");
    return true;
  }

  var prefix = getFilenamePrefix(getCurrentMainFilename());
  if (platform.getDownloadFile) {
    var dl = platform.getDownloadFile();
    var prefix = getFilenamePrefix(getCurrentMainFilename());
    saveAs(dl.blob, prefix + dl.extension);
  } else if (current_output instanceof Uint8Array) {
    var blob = new Blob([current_output], {type: "application/octet-stream"});
    var suffix = (platform.getROMExtension && platform.getROMExtension(current_output))
      || "-" + getBasePlatform(platform_id) + ".bin";
    saveAs(blob, prefix + suffix);
  } else {
    alertError(`The "${platform_id}" platform doesn't have downloadable ROMs.`);
  }
}

function _downloadSourceFile(e) {
  var text = projectWindows.getCurrentText();
  if (!text) return false;
  var blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  saveAs(blob, getCurrentEditorFilename(), {autoBom:false});
}

async function newJSZip() {
  let JSZip = (await import('jszip')).default;
  return new JSZip();
}

async function _downloadProjectZipFile(e) {
  var zip = await newJSZip();

  current_project.iterateFiles( (id, data) => {
    if (data) {
      zip.file(getFilenameForPath(id), data);
    }
  });

  zip.generateAsync({type:"blob"}).then( (content) => {
    saveAs(content, getCurrentMainFilename() + "-" + getBasePlatform(platform_id) + ".zip");
  });
}

function populateExamples(sel) {
  var files = {};
  sel.append($("<option />").text("--------- Examples ---------").attr('disabled','true'));
  for (var i=0; i<PRESETS.length; i++) {
    var preset = PRESETS[i];
    var name = preset.chapter ? (preset.chapter + ". " + preset.name) : preset.name;
    var isCurrentPreset = preset.id==current_project.mainPath;
    sel.append($("<option />").val(preset.id).text(name).attr('selected',isCurrentPreset?'selected':null));
    if (isCurrentPreset) current_preset = preset;
    files[preset.id] = name;
  }
  return files;
}

async function populateFiles(sel:JQuery, category:string, prefix:string, foundFiles:{}) {
  var keys = await store.keys();
  var numFound = 0;
  if (!keys) keys = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.startsWith(prefix) && !foundFiles[key]) {
      if (numFound++ == 0)
        sel.append($("<option />").text("------- " + category + " -------").attr('disabled','true'));
      var name = key.substring(prefix.length);
      sel.append($("<option />").val(key).text(name).attr('selected',(key==current_project.mainPath)?'selected':null));
    }
  }
}

function finishSelector(sel) {
  sel.css('visibility','visible');
  // create option if not selected
  var main = current_project.mainPath;
  if (sel.val() != main) {
    sel.append($("<option />").val(main).text(main).attr('selected','selected'));
  }
}

async function updateSelector() {
  var sel = $("#preset_select").empty();

  // normal: examples, and local files

  var foundFiles = populateExamples(sel);
  await populateFiles(sel, "Local Files", "", foundFiles);
  finishSelector(sel);

  // set click handlers
  sel.off('change').change(function(e) {
    reloadProject($(this).val().toString());
  });
}

function getErrorElement(err : WorkerError) {
  var span = $('<p/>');
  if (err.path != null) {
    var s = err.line ? err.label ? `(${err.path} @ ${err.label})` : `(${err.path}:${err.line})` : `(${err.path})`
    var link = $('<a/>').text(s);
    var path = err.path;

    // TODO: hack because examples/foo.a only gets listed as foo.a
    if (path == getCurrentMainFilename()) path = current_project.mainPath;

    // click link to open file, if it's available...
    if (projectWindows.isWindow(path)) {
      link.click((ev) => {
        var wnd = projectWindows.createOrShow(path);
        if (wnd instanceof SourceEditor) {
          wnd.setCurrentLine(err, true);
        }
      });
    }

    span.append(link);
    span.append('&nbsp;');
  }

  span.append($('<span/>').text(err.msg));
  return span;
}

function hideErrorAlerts() {
  $("#error_alert").hide();
  errorWasRuntime = false;
}

function showErrorAlert(errors : WorkerError[], runtime : boolean) {
  var div = $("#error_alert_msg").empty();
  for (var err of errors.slice(0,10)) {
    div.append(getErrorElement(err));
  }
  $("#error_alert").show();
  errorWasRuntime = runtime;
}

function showExceptionAsError(err, msg:string) {
  if (msg != null) {
    var werr : WorkerError = {msg:msg, line:0};
    if (err instanceof EmuHalt && err.$loc) {
      werr = Object.create(err.$loc);
      werr.msg = msg;
      console.log(werr);
    }
    showErrorAlert([werr], true);
  }
}

var measureTimeStart : Date = new Date();
var measureTimeLoad : Date;
function measureBuildTime() {
  if (measureTimeLoad) {
    var measureTimeBuild = new Date();
    console.log('load time', measureTimeLoad.getTime() - measureTimeStart.getTime());
    console.log('build time', measureTimeBuild.getTime() - measureTimeLoad.getTime());
    measureTimeLoad = null; // only measure once
  }
}

async function setCompileOutput(data: WorkerResult) {
  // errors? mark them in editor
  if ('errors' in data && data.errors.length > 0) {
    toolbar.addClass("has-errors");
    projectWindows.setErrors(data.errors);
    refreshWindowList(); // to make sure windows are created for showErrorAlert()
    showErrorAlert(data.errors, false);
  } else {
    toolbar.removeClass("has-errors"); // may be added in next callback
    projectWindows.setErrors(null);
    hideErrorAlerts();
    // exit if compile output unchanged
    if (data == null || ('unchanged' in data && data.unchanged)) return;
    // make sure it's a WorkerOutputResult
    if (!('output' in data)) return;
    // process symbol map
    platform.debugSymbols = new DebugSymbols(data.symbolmap, data.debuginfo);
    compparams = data.params;
    // load ROM
    var rom = data.output;
    if (rom != null) {
      try {
        clearBreakpoint(); // so we can replace memory (TODO: change toolbar btn)
        _resetRecording();
        await platform.loadROM(getCurrentPresetTitle(), rom);
        current_output = rom;
        if (!userPaused) _resume();
        measureBuildTime();
      } catch (e) {
        console.log(e);
        toolbar.addClass("has-errors");
        showExceptionAsError(e, e+"");
        current_output = null;
        refreshWindowList();
        return;
      }
    }
    // update all windows (listings)
    refreshWindowList();
    projectWindows.refresh(false);
  }
}

async function loadBIOSFromProject() {
  if (platform.loadBIOS) {
    var biospath = platform_id + '.rom';
    var biosdata = await store.getItem(biospath);
    if (biosdata instanceof Uint8Array) {
      console.log('loading BIOS', biospath, biosdata.length + " bytes")
      platform.loadBIOS(biospath, biosdata);
    } else {
      console.log('BIOS file must be binary')
    }
  }
}

function hideDebugInfo() {
  var meminfo = $("#mem_info");
  meminfo.hide();
  lastDebugInfo = null;
}

function showDebugInfo(state?) {
  if (!isDebuggable(platform)) return;
  var meminfo = $("#mem_info");
  var allcats = platform.getDebugCategories();
  if (allcats && !debugCategory)
    debugCategory = allcats[0];
  var s = state && platform.getDebugInfo(debugCategory, state);
  if (s) {
    var hs = lastDebugInfo ? highlightDifferences(lastDebugInfo, s) : s;
    meminfo.show().html(hs);
    var catspan = $('<div class="mem_info_links">');
    var addCategoryLink = (cat:string) => {
      var catlink = $('<a>'+cat+'</a>');
      if (cat == debugCategory)
        catlink.addClass('selected');
      catlink.click((e) => {
        debugCategory = cat;
        lastDebugInfo = null;
        showDebugInfo(lastDebugState);
      });
      catspan.append(catlink);
      catspan.append('<span> </span>');
    }
    for (var cat of allcats) {
      addCategoryLink(cat);
    }
    meminfo.append('<br>');
    meminfo.append(catspan);
    lastDebugInfo = s;
  } else {
    hideDebugInfo();
  }
}

function setDebugButtonState(btnid:string, btnstate:string) {
  $("#debug_bar, #run_bar").find("button").removeClass("btn_active").removeClass("btn_stopped");
  $("#dbg_"+btnid).addClass("btn_"+btnstate);
}

function isPlatformReady() {
  return platform && current_output != null;
}

function checkRunReady() {
  if (!isPlatformReady()) {
    alertError("Can't do this until build successfully completes.");
    return false;
  } else
    return true;
}

function openRelevantListing(state: EmuState) {
  // if we clicked on another window, retain it
  if (lastViewClicked != null) return;
  // has to support disassembly, at least
  if (!platform.disassemble) return;
  // search through listings
  var listings = current_project.getListings();
  var bestid = "#disasm";
  var bestscore = 32;
  if (listings) {
    var pc = state.c ? (state.c.EPC || state.c.PC) : 0;
    for (var lstfn in listings) {
      var lst = listings[lstfn];
      var file = lst.assemblyfile || lst.sourcefile;
      // pick either listing or source file
      var wndid = current_project.filename2path[lstfn] || lstfn;
      if (file == lst.sourcefile) wndid = projectWindows.findWindowWithFilePrefix(lstfn);
      // does this window exist?
      if (projectWindows.isWindow(wndid)) {
        var res = file && file.findLineForOffset(pc, 32); // TODO: const
        if (res && pc-res.offset < bestscore) {
          bestid = wndid;
          bestscore = pc-res.offset;
        }
        //console.log(hex(pc,4), wndid, lstfn, bestid, bestscore);
      }
    }
  }
  // if no appropriate listing found, use disassembly view
  projectWindows.createOrShow(bestid, true);
}

function uiDebugCallback(state: EmuState) {
  lastDebugState = state;
  showDebugInfo(state);
  openRelevantListing(state);
  projectWindows.refresh(true); // move cursor
  debugTickPaused = true;
}

function setupDebugCallback(btnid? : string) {
  if (platform.setupDebug) platform.setupDebug((state:EmuState, msg:string) => {
    uiDebugCallback(state);
    setDebugButtonState(btnid||"pause", "stopped");
    msg && showErrorAlert([{msg:"STOPPED: " + msg, line:0}], true);
  });
}

function setupBreakpoint(btnid? : string) {
  if (!checkRunReady()) return;
  _disableRecording();
  setupDebugCallback(btnid);
  if (btnid) setDebugButtonState(btnid, "active");
}

function _pause() {
  if (platform && platform.isRunning()) {
    platform.pause();
    console.log("Paused");
  }
  setDebugButtonState("pause", "stopped");
}

function pause() {
  if (!checkRunReady()) return;
  clearBreakpoint();
  _pause();
  userPaused = true;
}

function _resume() {
  if (!platform.isRunning()) {
    platform.resume();
    console.log("Resumed");
  }
  setDebugButtonState("go", "active");
  if (errorWasRuntime) { hideErrorAlerts(); }
}

function resume() {
  if (!checkRunReady()) return;
  clearBreakpoint();
  if (! platform.isRunning() ) {
    projectWindows.refresh(false);
  }
  _resume();
  userPaused = false;
  lastViewClicked = null;
}

function singleStep() {
  if (!checkRunReady()) return;
  setupBreakpoint("step");
  platform.step();
}

function stepOver() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepover");
  platform.stepOver();
}

function singleFrameStep() {
  if (!checkRunReady()) return;
  setupBreakpoint("tovsync");
  platform.runToVsync();
}

function getEditorPC() : number {
  var wnd = projectWindows.getActive();
  return wnd && wnd.getCursorPC && wnd.getCursorPC();
}

export function runToPC(pc: number) {
  if (!checkRunReady() || !(pc >= 0)) return;
  setupBreakpoint("toline");
  console.log("Run to", pc.toString(16));
  if (platform.runToPC) {
    platform.runToPC(pc);
  } else {
    platform.runEval((c) => {
      return c.PC == pc;
    });
  }
}

function restartAtCursor() {
  if (platform.restartAtPC(getEditorPC())) {
    resume();
  } else alertError(`Could not restart program at selected line.`);
}

function runToCursor() {
  runToPC(getEditorPC());
}

function runUntilReturn() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepout");
  platform.runUntilReturn();
}

function runStepBackwards() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepback");
  platform.stepBack();
}

function clearBreakpoint() {
  lastDebugState = null;
  if (platform.clearDebug) platform.clearDebug();
  setupDebugCallback(); // in case of BRK/trap
  showDebugInfo();
}

function resetPlatform() {
  platform.reset();
  _resetRecording();
}

function resetAndRun() {
  if (!checkRunReady()) return;
  clearBreakpoint();
  resetPlatform();
  _resume();
}

function resetAndDebug() {
  if (!checkRunReady()) return;
  var wasRecording = recorderActive;
  _disableRecording();
  if (platform.setupDebug && platform.runEval) { // TODO??
    clearBreakpoint();
    _resume();
    resetPlatform();
    setupBreakpoint("restart");
    platform.runEval((c) => { return true; }); // break immediately
  } else {
    resetPlatform();
    _resume();
  }
  if (wasRecording) _enableRecording();
}

function _breakExpression() {
  var modal = $("#debugExprModal");
  var btn = $("#debugExprSubmit");
  $("#debugExprInput").val(lastBreakExpr);
  $("#debugExprExamples").text(getDebugExprExamples());
  modal.modal('show');
  btn.off('click').on('click', () => {
    var exprs = $("#debugExprInput").val()+"";
    modal.modal('hide');
    breakExpression(exprs);
  });
}

function getDebugExprExamples() : string {
  var state = platform.saveState && platform.saveState();
  var cpu = state.c;
  console.log(cpu, state);
  var s = '';
  if (cpu.PC) s += "c.PC == 0x" + hex(cpu.PC) + "\n";
  if (cpu.SP) s += "c.SP < 0x" + hex(cpu.SP) + "\n";
  if (cpu['HL']) s += "c.HL == 0x4000\n";
  if (platform.readAddress) s += "this.readAddress(0x1234) == 0x0\n";
  if (platform.readVRAMAddress) s += "this.readVRAMAddress(0x1234) != 0x80\n";
  if (platform['getRasterScanline']) s += "this.getRasterScanline() > 222\n";
  return s;
}

function breakExpression(exprs : string) {
  var fn = new Function('c', 'return (' + exprs + ');').bind(platform);
  setupBreakpoint();
  platform.runEval(fn as DebugEvalCondition);
  lastBreakExpr = exprs;
}

function updateDebugWindows() {
  if (platform.isRunning()) {
    projectWindows.tick();
    debugTickPaused = false;
  } else if (!debugTickPaused) { // final tick after pausing
    projectWindows.tick();
    debugTickPaused = true;
  }
  setTimeout(updateDebugWindows, 100);
}

function setWaitDialog(b : boolean) {
  if (b) {
    setWaitProgress(0);
    $("#pleaseWaitModal").modal('show');
  } else {
    setWaitProgress(1);
    $("#pleaseWaitModal").modal('hide');
  }
}

function setWaitProgress(prog : number) {
  $("#pleaseWaitProgressBar").css('width', (prog*100)+'%').show();
}

var recordingVideo = false;
function _recordVideo() {
  if (recordingVideo) return;
 loadScript("dist/gif.js").then( () => {
  var canvas = $("#emulator").find("canvas")[0] as HTMLElement;
  if (!canvas) {
    alertError("Could not find canvas element to record video!");
    return;
  }
  var rotate = 0;
  if (canvas.style && canvas.style.transform) {
    if (canvas.style.transform.indexOf("rotate(-90deg)") >= 0)
      rotate = -1;
    else if (canvas.style.transform.indexOf("rotate(90deg)") >= 0)
      rotate = 1;
  }
  var gif = new GIF({
    workerScript: 'dist/gif.worker.js',
    workers: 4,
    quality: 10,
    rotate: rotate
  });
  var img = $('#videoPreviewImage');
  gif.on('progress', (prog) => {
    setWaitProgress(prog);
  });
  gif.on('finished', (blob) => {
    img.attr('src', URL.createObjectURL(blob));
    setWaitDialog(false);
    _resume();
    $("#videoPreviewModal").modal('show');
  });
  var intervalMsec = 20;
  var maxFrames = 300;
  var nframes = 0;
  console.log("Recording video", canvas);
  $("#emulator").css('backgroundColor', '#cc3333');
  var f = () => {
    if (nframes++ > maxFrames) {
      console.log("Rendering video");
      $("#emulator").css('backgroundColor', 'inherit');
      setWaitDialog(true);
      _pause();
      gif.render();
      recordingVideo = false;
    } else {
      gif.addFrame(canvas, {delay: intervalMsec, copy: true});
      setTimeout(f, intervalMsec);
      recordingVideo = true;
    }
  };
  f();
 });
}

export function setFrameRateUI(fps:number) {
  platform.setFrameRate(fps);
  if (fps > 0.01)
    $("#fps_label").text(fps.toFixed(2));
  else
    $("#fps_label").text("1/"+Math.round(1/fps));
}

function _slowerFrameRate() {
  var fps = platform.getFrameRate();
  fps = fps/2;
  if (fps > 0.00001) setFrameRateUI(fps);
}

function _fasterFrameRate() {
  var fps = platform.getFrameRate();
  fps = Math.min(60, fps*2);
  setFrameRateUI(fps);
}

function _slowestFrameRate() {
  setFrameRateUI(60/65536);
}

function _fastestFrameRate() {
  _resume();
  setFrameRateUI(60);
}

function _disableRecording() {
  if (recorderActive) {
    platform.setRecorder(null);
    $("#dbg_record").removeClass("btn_recording");
    $("#replaydiv").hide();
    hideDebugInfo();
    recorderActive = false;
  }
}

function _resetRecording() {
  if (recorderActive) {
    stateRecorder.reset();
  }
}

function _enableRecording() {
  stateRecorder.reset();
  platform.setRecorder(stateRecorder);
  $("#dbg_record").addClass("btn_recording");
  $("#replaydiv").show();
  recorderActive = true;
}

function _toggleRecording() {
  if (recorderActive) {
    _disableRecording();
  } else {
    _enableRecording();
  }
}

function _lookupHelp() {
  if (platform.showHelp) {
    let tool = platform.getToolForFilename(current_project.mainPath);
    platform.showHelp(tool); // TODO: tool, identifier
  }
}

function addFileToProject(type, ext, linefn) {
  var wnd = projectWindows.getActive();
  if (wnd && wnd.insertText) {
    bootbox.prompt({
      title:"Add "+type+" File to Project",
      value:"filename"+ext,
      callback:(filename:string) => {
        if (filename && filename.trim().length > 0) {
          if (!checkEnteredFilename(filename)) return;
          var path = filename;
          var newline = "\n" + linefn(filename) + "\n";
          current_project.loadFiles([path]).then((result) => {
            if (result && result.length) {
              alertError(filename + " already exists; including anyway");
            } else {
              current_project.updateFile(path, "\n");
            }
            wnd.insertText(newline);
            refreshWindowList();
          });
        }
      }
    });
  } else {
    alertError("Can't insert text in this window -- switch back to main file");
  }
}

function setupDebugControls() {

  // create toolbar buttons
  uitoolbar = new Toolbar($("#toolbar")[0], null);
  uitoolbar.grp.prop('id','run_bar');
  uitoolbar.add('ctrl+alt+r', 'Reset', 'glyphicon-refresh', resetAndRun).prop('id','dbg_reset');
  uitoolbar.add('ctrl+alt+,', 'Pause', 'glyphicon-pause', pause).prop('id','dbg_pause');
  uitoolbar.add('ctrl+alt+.', 'Resume', 'glyphicon-play', resume).prop('id','dbg_go');

  if (platform.restartAtPC) {
    uitoolbar.add('ctrl+alt+/', 'Restart at Cursor', 'glyphicon-play-circle', restartAtCursor).prop('id','dbg_restartatline');
  }

  uitoolbar.newGroup();
  uitoolbar.grp.prop('id','debug_bar');

  if (platform.runEval) {
    uitoolbar.add('ctrl+alt+e', 'Reset and Debug', 'glyphicon-fast-backward', resetAndDebug).prop('id','dbg_restart');
  }

  if (platform.stepBack) {
    uitoolbar.add('ctrl+alt+b', 'Step Backwards', 'glyphicon-step-backward', runStepBackwards).prop('id','dbg_stepback');
  }

  if (platform.step) {
    uitoolbar.add('ctrl+alt+s', 'Single Step', 'glyphicon-step-forward', singleStep).prop('id','dbg_step');
  }

  if (platform.stepOver) {
    uitoolbar.add('ctrl+alt+t', 'Step Over', 'glyphicon-hand-right', stepOver).prop('id','dbg_stepover');
  }

  if (platform.runUntilReturn) {
    uitoolbar.add('ctrl+alt+o', 'Step Out of Subroutine', 'glyphicon-hand-up', runUntilReturn).prop('id','dbg_stepout');
  }

  if (platform.runToVsync) {
    uitoolbar.add('ctrl+alt+n', 'Next Frame/Interrupt', 'glyphicon-forward', singleFrameStep).prop('id','dbg_tovsync');
  }

  if ((platform.runEval || platform.runToPC) && !platform_id.startsWith('verilog')) {
    uitoolbar.add('ctrl+alt+l', 'Run To Line', 'glyphicon-save', runToCursor).prop('id','dbg_toline');
  }

  uitoolbar.newGroup();
  uitoolbar.grp.prop('id','xtra_bar');

  // add menu clicks
  $(".dropdown-menu").collapse({toggle: false});
  $("#item_share_file").click(_shareEmbedLink);

  if (platform.runEval)
    $("#item_debug_expr").click(_breakExpression).show();
  else
    $("#item_debug_expr").hide();

  $("#item_download_rom").click(_downloadROMImage);
  $("#item_download_file").click(_downloadSourceFile);
  $("#item_download_zip").click(_downloadProjectZipFile);
  $("#item_record_video").click(_recordVideo);

  if (platform_id.startsWith('apple2') || platform_id.startsWith('vcs')) // TODO: look for function
    $("#item_export_cassette").click(_downloadCassetteFile);
  else
    $("#item_export_cassette").hide();

  if (platform.setFrameRate && platform.getFrameRate) {
    $("#dbg_slower").click(_slowerFrameRate);
    $("#dbg_faster").click(_fasterFrameRate);
    $("#dbg_slowest").click(_slowestFrameRate);
    $("#dbg_fastest").click(_fastestFrameRate);
  }

  updateDebugWindows();

  // show help button?
  if (platform.showHelp) {
    uitoolbar.add('ctrl+alt+?', 'Show Help', 'glyphicon-question-sign', _lookupHelp);
  }

  // setup replay slider
  if (platform.setRecorder && platform.advance) {
    setupReplaySlider();
  }
}

function setupReplaySlider() {
    var replayslider = $("#replayslider");
    var clockslider = $("#clockslider");
    var replayframeno = $("#replay_frame");
    var clockno = $("#replay_clock");

    if (!platform.advanceFrameClock) $("#clockdiv").hide(); // TODO: put this test in recorder?

    var updateFrameNo = () => {
      replayframeno.text(stateRecorder.lastSeekFrame+"");
      clockno.text(stateRecorder.lastSeekStep+"");
    };

    var sliderChanged = (e) => {
      _pause();
      var frame : number = parseInt(replayslider.val().toString());
      var step : number = parseInt(clockslider.val().toString());
      if (stateRecorder.loadFrame(frame, step) >= 0) {
        clockslider.attr('min', 0);
        clockslider.attr('max', stateRecorder.lastStepCount);
        updateFrameNo();
        uiDebugCallback(platform.saveState());
      }
    };

    var setFrameTo = (frame:number) => {
      _pause();
      if (stateRecorder.loadFrame(frame) >= 0) {
        replayslider.val(frame);
        updateFrameNo();
        uiDebugCallback(platform.saveState());
      }
    };

    var setClockTo = (clock:number) => {
      _pause();
      var frame : number = parseInt(replayslider.val().toString());
      if (stateRecorder.loadFrame(frame, clock) >= 0) {
        clockslider.val(clock);
        updateFrameNo();
        uiDebugCallback(platform.saveState());
      }
    };

    stateRecorder.callbackStateChanged = () => {
      replayslider.attr('min', 0);
      replayslider.attr('max', stateRecorder.numFrames());
      replayslider.val(stateRecorder.currentFrame());
      clockslider.val(stateRecorder.currentStep());
      updateFrameNo();
      showDebugInfo(platform.saveState());
    };

    replayslider.on('input', sliderChanged);
    clockslider.on('input', sliderChanged);
    //replayslider.on('change', sliderChanged);

    $("#replay_min").click(() => { setFrameTo(1) });
    $("#replay_max").click(() => { setFrameTo(stateRecorder.numFrames()); });
    $("#replay_back").click(() => { setFrameTo(parseInt(replayslider.val().toString()) - 1); });
    $("#replay_fwd").click(() => { setFrameTo(parseInt(replayslider.val().toString()) + 1); });
    $("#clock_back").click(() => { setClockTo(parseInt(clockslider.val().toString()) - 1); });
    $("#clock_fwd").click(() => { setClockTo(parseInt(clockslider.val().toString()) + 1); });
    $("#replay_bar").show();

    uitoolbar.add('ctrl+alt+0', 'Start/Stop Replay Recording', 'glyphicon-record', _toggleRecording).prop('id','dbg_record');
}


function isLandscape() {
  try {
    var object = window.screen['orientation'] || window.screen['msOrientation'] || window.screen['mozOrientation'] || null;
    if (object) {
      if (object.type.indexOf('landscape') !== -1) { return true; }
      if (object.type.indexOf('portrait') !== -1) { return false; }
    }
    if ('orientation' in window) {
      var value = window.orientation;
      if (value === 0 || value === 180) {
        return false;
      } else if (value === 90 || value === 270) {
        return true;
      }
    }
  } catch (e) { }

  // fallback to comparing width to height
  return window.innerWidth > window.innerHeight;
}

///////////////////////////////////////////////////

function globalErrorHandler(msgevent) {
  var err = msgevent.error || msgevent.reason;
  if (err != null && err instanceof EmuHalt) {
    haltEmulation(err);
  }
}

export function haltEmulation(err?: EmuHalt) {
  console.log("haltEmulation");
  _pause();
  emulationHalted(err);
  // TODO: reset platform?
}

// catch errors
function installErrorHandler() {
  window.addEventListener('error', globalErrorHandler);
  window.addEventListener('unhandledrejection', globalErrorHandler);
}

function uninstallErrorHandler() {
  window.removeEventListener('error', globalErrorHandler);
  window.removeEventListener('unhandledrejection', globalErrorHandler);
}

function gotoNewLocation(replaceHistory? : boolean) {
  uninstallErrorHandler();
  if (replaceHistory)
    window.location.replace("?" + $.param(qs));
  else
    window.location.href = "?" + $.param(qs);
}

function replaceURLState() {
  if (platform_id) qs.platform = platform_id;
  delete qs['']; // remove null parameter
  history.replaceState({}, "", "?" + $.param(qs));
}

function addPageFocusHandlers() {
  var hidden = false;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState == 'hidden' && platform && platform.isRunning()) {
      _pause();
      hidden = true;
    } else if (document.visibilityState == 'visible' && hidden) {
      _resume();
      hidden = false;
    }
  });

  $(window).on("focus", () => {
    if (hidden) {
      _resume();
      hidden = false;
    }
  });

  $(window).on("blur", () => {
    if (platform && platform.isRunning()) {
      _pause();
      hidden = true;
    }
  });

  $(window).on("orientationchange", () => {
    if (platform && platform.resize) setTimeout(platform.resize.bind(platform), 200);
  });
}

// TODO: merge w/ player.html somehow?
function showInstructions() {
  var div = $(document).find(".emucontrols-" + getRootBasePlatform(platform_id));
  if (platform_id.endsWith(".mame")) div.show(); // TODO: MAME seems to eat the focus() event
  var vcanvas = $("#emulator").find("canvas");
  if (vcanvas) {
    vcanvas.on('focus', () => {
      if (platform.isRunning()) {
        div.fadeIn(200);
        // toggle sound for browser autoplay
        platform.resume();
      }
    });
    vcanvas.on('blur', () => {
      div.fadeOut(200);
    });
  }
}

async function startPlatform() {
  platform = new ZXWASMPlatform($("#emuscreen")[0]);
  setPlatformUI();
  stateRecorder = new StateRecorderImpl(platform);
  PRESETS = platform.getPresets ? platform.getPresets() : [];
  if (!qs.file) {
    // load first preset file, unless we're in a repo
    var defaultfile = PRESETS[0].id;
    qs.file = defaultfile || 'DEFAULT';
    if (!defaultfile) {
      alertError("There is no default main file for this project. Try selecting one from the pulldown.");
    }
  }

  // start platform and load file
  replaceURLState();
  installErrorHandler();
  await platform.start();
  await loadBIOSFromProject();
  await initProject();
  await loadProject(qs.file);
  platform.sourceFileFetch = (path) => current_project.filedata[path];
  setupDebugControls();
  addPageFocusHandlers();
  showInstructions();

  if (isEmbed) {
    hideControlsForEmbed();
  } else {
    updateSelector();
  }

  revealTopBar();
}

function hideControlsForEmbed() {
  $('#dropdownMenuButton').hide();
  $('#platformsMenuButton').hide();
  $('#booksMenuButton').hide();
}

function revealTopBar() {
  setTimeout(() => { $("#controls_dynamic").css('visibility','inherit'); }, 250);
}

export function setupSplits() {
  var splitName = 'workspace-split3-' + platform_id;
  if (isEmbed) splitName = 'embed-' + splitName;

  var sizes;
  if (isEmbed || isMobileDevice)
    sizes = [0, 55, 45];
  else
    sizes = [12, 44, 44];

  var split = Split(['#sidebar', '#workspace', '#emulator'], {
    sizes: sizes,
    minSize: [0, 250, 250],
    onDrag: () => {
      if (platform && platform.resize) platform.resize();
    },
    onDragEnd: () => {
      if (projectWindows) projectWindows.resize();
    },
  });
}

function setPlatformUI() {
  var name = platform.getPlatformName && platform.getPlatformName();
  var menuitem = $('a[href="?platform='+platform_id+'"]');
  if (menuitem.length) {
    menuitem.addClass("dropdown-item-checked");
    name = name || menuitem.text() || name;
  }
  $(".platform_name").text(name || platform_id);
}

// start
export async function startUI() {
  platform_id = 'zx';

  setupSplits();

  // get store ID, platform id
  store_id = getBasePlatform(platform_id);

  // are we embedded?
  if (isEmbed) {
    store_id = (document.referrer || document.location.href) + store_id;
  }

  // create store
  store = createNewPersistentStore(store_id);

  // load and start platform object
  loadAndStartPlatform();
}

async function loadAndStartPlatform() {
  try {
    console.assert(getRootBasePlatform(platform_id) === 'zx', getRootBasePlatform(platform_id));
    await import("../machine/zx")

    console.log("starting platform", platform_id); // loaded required <platform_id>.js file
    await startPlatform();

    document.title = document.title + " [" + platform_id + "] - " + current_project.mainPath;
  } catch (e) {
    console.log(e);
    alertError('Platform "' + platform_id + '" failed to load.');
  } finally {
    revealTopBar();
  }
}

// HTTPS REDIRECT

const useHTTPSCookieName = "__use_https";

function setHTTPSCookie(val : number) {
  document.cookie = useHTTPSCookieName + "=" + val + ";domain=8bitworkshop.com;path=/;max-age=315360000";
}

function shouldRedirectHTTPS() : boolean {

  // cookie set? either true or false
  var shouldRedir = getCookie(useHTTPSCookieName);
  if (typeof shouldRedir === 'string') {
    return !!shouldRedir; // convert to bool
  }

  // set a 10yr cookie, value depends on if it's our first time here
  var val = 0;
  setHTTPSCookie(val);

  return !!val;
}

function _switchToHTTPS() {
  bootbox.confirm('<p>Do you want to force the browser to use HTTPS from now on?</p>'+
  '<p>WARNING: This will make all of your local files unavailable, so you should "Download All Changes" first for each platform where you have done work.</p>'+
  '<p>You can go back to HTTP by setting the "'+useHTTPSCookieName+'" cookie to 0.</p>', (ok) => {
    if (ok) {
      setHTTPSCookie(1);
      redirectToHTTPS();
    }
  });
}

function redirectToHTTPS() {
  if (window.location.protocol == 'http:' && window.location.host == '8bitworkshop.com') {
    if (shouldRedirectHTTPS()) {
      uninstallErrorHandler();
      window.location.replace(window.location.href.replace(/^http:/, 'https:'));
    } else {
      $("#item_switch_https").click(_switchToHTTPS).show();
    }
  }
}

// redirect to HTTPS after script loads?
redirectToHTTPS();

export function emulationHalted(err: EmuHalt) {
  var msg = (err && err.message) || msg;
  showExceptionAsError(err, msg);
  projectWindows.refresh(false); // don't mess with cursor
  if (platform.saveState) showDebugInfo(platform.saveState());
}

// get remote file from local fs
declare var alternateLocalFilesystem : ProjectFilesystem;

export async function reloadWorkspaceFile(path: string) {
  var oldval = current_project.filedata[path];
  if (oldval != null) {
    projectWindows.updateFile(path, await alternateLocalFilesystem.getFileData(path));
    console.log('updating file', path);
  }
}

export function highlightSearch(query: string) { // TODO: filename?
  var wnd = projectWindows.getActive();
  if (wnd instanceof SourceEditor) {
    var sc = wnd.editor.getSearchCursor(query);
    if (sc.findNext()) {
      wnd.editor.setSelection(sc.pos.to, sc.pos.from);
    }
  }
}

function startUIWhenVisible() {
  let started = false;
  let observer = new IntersectionObserver((entries, observer) => {
    for (var entry of entries) {
      if (entry.isIntersecting && !started) {
        startUI();
        started = true;
      }
      if (entry.intersectionRatio == 0 && isPlatformReady() && platform.isRunning()) {
        _pause();
      }
      if (entry.intersectionRatio > 0 && isPlatformReady() && !platform.isRunning()) {
        _resume();
      }
    }
  }, { });
  observer.observe($("#emulator")[0]); //window.document.body);
}

/// start UI if in browser (not node)
if (typeof process === 'undefined') {
  // if embedded, do not start UI until we scroll past it
  if (isEmbed && typeof IntersectionObserver === 'function') {
    startUIWhenVisible();
  } else {
    startUI();
  }
}
