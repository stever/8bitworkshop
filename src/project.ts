import {
    FileData,
    CodeListingMap,
    Segment,
    WorkerResult
} from "./worker/types";
import {getFilenamePrefix, getFolderForPath} from "./util";
import localforage from "localforage";
import {ZXWASMPlatform} from "./emulator/zx_platform";
import {
    CodeListing,
    Dependency,
    WorkerItemUpdate,
    WorkerMessage,
    WorkerOutputResult
} from "./worker/interfaces";
import {SourceFile} from "./worker/SourceFile";

function isProbablyBinary(path: string, data?: number[] | Uint8Array): boolean {
    var score = 0;

    // check extensions
    if (path) {
        path = path.toUpperCase();
        const BINEXTS = ['.CHR', '.BIN', '.DAT', '.PAL', '.NAM', '.RLE', '.LZ4', '.NSF'];
        for (var ext of BINEXTS) {
            if (path.endsWith(ext)) {
                score++;
            }
        }
    }

    // decode as UTF-8
    for (var i = 0; i < (data ? data.length : 0);) {
        let c = data[i++];
        if ((c & 0x80) == 0) {

            // more likely binary if we see a NUL or obscure control character
            if (c < 9 || (c >= 14 && c < 26) || c == 0x7f) {
                score++;
                break;
            }
        } else {

            // look for invalid unicode sequences
            var nextra = 0;

            if ((c & 0xe0) == 0xc0) {
                nextra = 1;
            } else if ((c & 0xf0) == 0xe0) {
                nextra = 2;
            } else if ((c & 0xf8) == 0xf0) {
                nextra = 3;
            } else if (c < 0xa0) {
                score++;
            } else if (c == 0xff) {
                score++;
            }

            while (nextra--) {
                if (i >= data.length || (data[i++] & 0xc0) != 0x80) {
                    score++;
                    break;
                }
            }
        }
    }

    return score > 0;
}

// firefox doesn't do GET with binary files
function getWithBinary(url: string, success: (text: string | Uint8Array) => void, datatype: 'text' | 'arraybuffer') {
    var oReq = new XMLHttpRequest();
    oReq.open("GET", url, true);
    oReq.responseType = datatype;

    oReq.onload = function (oEvent) {
        if (oReq.status == 200) {
            var data = oReq.response;

            if (data instanceof ArrayBuffer) {
                data = new Uint8Array(data);
            }

            success(data);
        } else if (oReq.status == 404) {
            success(null);
        } else {
            throw Error("Error " + oReq.status + " loading " + url);
        }
    }

    oReq.onerror = function (oEvent) {
        success(null);
    }

    oReq.ontimeout = function (oEvent) {
        throw Error("Timeout loading " + url);
    }

    oReq.send(null);
}

export interface ProjectFilesystem {
    getFileData(path: string): Promise<FileData>;

    setFileData(path: string, data: FileData): Promise<void>;
}

export class WebPresetsFileSystem implements ProjectFilesystem {

    async getRemoteFile(path: string): Promise<FileData> {
        return new Promise((yes, no) => {
            return getWithBinary(path, yes, isProbablyBinary(path) ? 'arraybuffer' : 'text');
        });
    }

    async getFileData(path: string): Promise<FileData> {
        // found on remote fetch?
        var webpath = "presets/zx/" + path;
        var data = await this.getRemoteFile(webpath);
        if (data) {
            console.log("read", webpath, data.length, 'bytes');
        }

        return data;
    }

    async setFileData(path: string, data: FileData): Promise<void> {
        // not implemented
    }
}

export class OverlayFilesystem implements ProjectFilesystem {
    basefs: ProjectFilesystem;
    overlayfs: ProjectFilesystem;

    constructor(basefs: ProjectFilesystem, overlayfs: ProjectFilesystem) {
        this.basefs = basefs;
        this.overlayfs = overlayfs;
    }

    async getFileData(path: string): Promise<FileData> {
        var data = await this.overlayfs.getFileData(path);
        if (data == null) {
            return this.basefs.getFileData(path);
        } else {
            return data;
        }
    }

    async setFileData(path: string, data: FileData): Promise<void> {
        await this.overlayfs.setFileData(path, data);
        return this.basefs.setFileData(path, data);
    }
}

export class LocalForageFilesystem {
    store: any;

    constructor(store: any) {
        this.store = store;
    }

    async getFileData(path: string): Promise<FileData> {
        return this.store.getItem(path);
    }

    async setFileData(path: string, data: FileData): Promise<void> {
        return this.store.setItem(path, data);
    }
}

type BuildResultCallback = (result: WorkerResult) => void;
type BuildStatusCallback = (busy: boolean) => void;
type IterateFilesCallback = (path: string, data: FileData) => void;

function isOutputResult(result: WorkerResult): result is WorkerOutputResult<any> {
    return ('output' in result);
}

export class CodeProject {
    filedata: { [path: string]: FileData } = {};
    listings: CodeListingMap;
    segments: Segment[];
    mainPath: string;
    pendingWorkerMessages = 0;
    tools_preloaded = {};
    worker: Worker;
    platform: ZXWASMPlatform;
    isCompiling: boolean = false;
    filename2path = {}; // map stripped paths to full paths
    filesystem: ProjectFilesystem;
    dataItems: WorkerItemUpdate[];

    callbackBuildResult: BuildResultCallback;
    callbackBuildStatus: BuildStatusCallback;

    constructor(worker, platform, filesystem: ProjectFilesystem) {
        this.worker = worker;
        this.platform = platform;
        this.filesystem = filesystem;

        worker.onmessage = (e) => {
            this.receiveWorkerMessage(e.data);
        };
    }

    receiveWorkerMessage(data: WorkerResult) {
        var notfinal = this.pendingWorkerMessages > 1;
        if (notfinal) {
            this.sendBuild();
            this.pendingWorkerMessages = 1;
        } else {
            if (this.callbackBuildStatus) {
                this.callbackBuildStatus(false);
            }

            if (!this.isCompiling) {
                console.log(this.pendingWorkerMessages);
                console.trace();
            }

            // debug compile problems
            this.isCompiling = false;
            this.pendingWorkerMessages = 0;
        }

        if (data && isOutputResult(data)) {
            this.processBuildResult(data);
        }

        this.callbackBuildResult(data);
    }

    preloadWorker(path: string) {
        var tool = this.platform.getToolForFilename(path);
        if (tool && !this.tools_preloaded[tool]) {
            this.worker.postMessage({
                preload: tool
            });

            this.tools_preloaded[tool] = true;
        }
    }

    pushAllFiles(files: string[], fn: string) {
        // look for local and preset files
        files.push(fn);

        // look for files in current (main file) folder
        var dir = getFolderForPath(this.mainPath);
        if (dir.length > 0 && dir != 'local') {
            files.push(dir + '/' + fn);
        }
    }

    parseIncludeDependencies(text: string): string[] {
        let files = [];
        let m;

        // for .asm -- [.%]include "file"
        // for .c -- #include "file"
        let re2 = /^\s*[.#%]?(include|incbin)\s+"(.+?)"/gmi;
        while (m = re2.exec(text)) {
            this.pushAllFiles(files, m[2]);
        }

        // for .c -- //#resource "file" (or ;resource or #resource)
        let re3 = /^\s*([;']|[/][/])#resource\s+"(.+?)"/gm;
        while (m = re3.exec(text)) {
            this.pushAllFiles(files, m[2]);
        }

        return files;
    }

    parseLinkDependencies(text: string): string[] {
        let files = [];
        let m;

        // for .c -- //#link "file" (or ;link or #link)
        let re = /^\s*([;]|[/][/])#link\s+"(.+?)"/gm;
        while (m = re.exec(text)) {
            this.pushAllFiles(files, m[2]);
        }

        return files;
    }

    loadFileDependencies(text: string): Promise<Dependency[]> {
        let includes = this.parseIncludeDependencies(text);
        let linkfiles = this.parseLinkDependencies(text);
        let allfiles = includes.concat(linkfiles);

        return this.loadFiles(allfiles).then((result) => {
            // set 'link' property on files that are link dependencies (must match filename)
            if (result) {
                for (let dep of result) {
                    dep.link = linkfiles.indexOf(dep.path) >= 0;
                }
            }

            return result;
        });
    }

    okToSend(): boolean {
        return this.pendingWorkerMessages++ == 0 && this.mainPath != null;
    }

    updateFileInStore(path: string, text: FileData) {
        this.filesystem.setFileData(path, text);
    }

    buildWorkerMessage(depends: Dependency[]): WorkerMessage {
        this.preloadWorker(this.mainPath);

        var msg: WorkerMessage = {updates: [], buildsteps: []};
        var mainfilename = this.stripLocalPath(this.mainPath);
        var maintext = this.getFile(this.mainPath);
        var depfiles = [];

        msg.updates.push({path: mainfilename, data: maintext});
        this.filename2path[mainfilename] = this.mainPath;

        for (var dep of depends) {
            if (!dep.link) {
                msg.updates.push({path: dep.filename, data: dep.data});
                depfiles.push(dep.filename);
            }

            this.filename2path[dep.filename] = dep.path;
        }

        msg.buildsteps.push({
            path: mainfilename,
            files: [mainfilename].concat(depfiles),
            tool: this.platform.getToolForFilename(this.mainPath),
            mainfile: true
        });

        for (var dep of depends) {
            if (dep.data && dep.link) {
                this.preloadWorker(dep.filename);
                msg.updates.push({path: dep.filename, data: dep.data});
                msg.buildsteps.push({
                    path: dep.filename,
                    files: [dep.filename].concat(depfiles),
                    tool: this.platform.getToolForFilename(dep.path)
                });
            }
        }

        if (this.dataItems) {
            msg.setitems = this.dataItems;
        }

        return msg;
    }

    async loadFiles(paths: string[]): Promise<Dependency[]> {
        var result: Dependency[] = [];
        var addResult = (path: string, data: FileData) => {
            result.push({
                path: path,
                filename: this.stripLocalPath(path),
                link: true,
                data: data
            });
        }

        for (var path of paths) {
            // look in cache
            if (path in this.filedata) { // found in cache?
                var data = this.filedata[path];
                if (data) {
                    addResult(path, data);
                }
            } else {
                var data = await this.filesystem.getFileData(path);
                if (data) {
                    this.filedata[path] = data; // do not update fileStore, just cache
                    addResult(path, data);
                } else {
                    this.filedata[path] = null; // mark entry as invalid
                }
            }
        }

        return result;
    }

    getFile(path: string): FileData {
        return this.filedata[path];
    }

    iterateFiles(callback: IterateFilesCallback) {
        for (var path in this.filedata) {
            callback(path, this.getFile(path));
        }
    }

    sendBuild() {
        if (!this.mainPath) {
            throw Error("need to call setMainFile first");
        }

        var maindata = this.getFile(this.mainPath);

        // if binary blob, just return it as ROM
        if (maindata instanceof Uint8Array) {
            this.isCompiling = true;

            this.receiveWorkerMessage({
                output: maindata,
                errors: [],
                listings: null,
                symbolmap: null,
                params: {}
            });

            return;
        }

        // otherwise, make it a string
        var text = typeof maindata === "string" ? maindata : '';
        return this.loadFileDependencies(text).then((depends) => {
            if (!depends) {
                depends = [];
            }

            var workermsg = this.buildWorkerMessage(depends);
            this.worker.postMessage(workermsg);
            this.isCompiling = true;
        });
    }

    updateFile(path: string, text: FileData) {
        if (this.filedata[path] == text) {
            return; // unchanged, don't update
        }

        this.updateFileInStore(path, text);
        this.filedata[path] = text;

        if (this.okToSend()) {
            if (this.callbackBuildStatus) {
                this.callbackBuildStatus(true);
            }

            this.sendBuild();
        }
    };

    setMainFile(path: string) {
        this.mainPath = path;

        if (this.callbackBuildStatus) {
            this.callbackBuildStatus(true);
        }

        this.sendBuild();
    }

    processBuildResult(data: WorkerOutputResult<any>) {
        if (data.listings) {
            this.listings = data.listings;
            for (var lstname in this.listings) {
                var lst = this.listings[lstname];

                if (lst.lines) {
                    lst.sourcefile = new SourceFile(lst.lines, lst.text);
                }

                if (lst.asmlines) {
                    lst.assemblyfile = new SourceFile(lst.asmlines, lst.text);
                }
            }
        }

        // save and sort segment list
        var segs: Segment[] = this.platform.getMemoryMap()["main"];
        if (data.segments) {
            segs = segs.concat(data.segments || []);
        }

        segs.sort((a, b) => {
            return a.start - b.start
        });

        this.segments = segs;
    }

    getListings(): CodeListingMap {
        return this.listings;
    }

    // returns first listing in format [prefix].lst
    getListingForFile(path: string): CodeListing {
        var fnprefix = getFilenamePrefix(this.stripLocalPath(path));
        var listings = this.getListings();
        var onlyfile = null;

        for (var lstfn in listings) {
            onlyfile = lstfn;

            if (getFilenamePrefix(lstfn) == fnprefix) {
                return listings[lstfn];
            }
        }
    }

    stripLocalPath(path: string): string {
        if (this.mainPath) {
            var folder = getFolderForPath(this.mainPath);

            if (folder != '' && path.startsWith(folder)) {
                path = path.substring(folder.length + 1);
            }
        }

        return path;
    }

    updateDataItems(items: WorkerItemUpdate[]) {
        this.dataItems = items;

        if (this.okToSend()) {
            this.sendBuild();
        }
    }

}

export function createNewPersistentStore(storeid: string): LocalForage {
    return localforage.createInstance({
        name: "__" + storeid,
        version: 2.0
    });
}
