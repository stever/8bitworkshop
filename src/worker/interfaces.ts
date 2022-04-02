import {CodeListingMap, FileData, Segment} from "./types";
import {SourceFile} from "./SourceFile";

export interface SourceLocation {
    line: number;
    label?: string;
    path?: string;
    start?: number;
    end?: number;
    segment?: string;
    func?: string;
}

// actually it's a kind of SourceSnippet .. can have multiple per line
export interface SourceLine extends SourceLocation {
    offset: number;
    insns?: string;
    iscode?: boolean;
    cycles?: number;
}

export interface Dependency {
    path: string
    filename: string
    link: boolean
    data: FileData
}

export interface WorkerFileUpdate {
    path: string
    data: FileData
}

export interface WorkerBuildStep {
    path?: string
    files?: string[]
    platform: string
    tool: string
    mainfile?: boolean
}

export interface WorkerItemUpdate {
    key: string
    value: object
}

export interface WorkerMessage {
    preload?: string
    platform?: string
    tool?: string
    updates: WorkerFileUpdate[]
    buildsteps: WorkerBuildStep[]
    reset?: boolean
    code?: string
    setitems?: WorkerItemUpdate[]
}

export interface WorkerError extends SourceLocation {
    msg: string,
}

export interface CodeListing {
    lines: SourceLine[]
    asmlines?: SourceLine[]
    text?: string
    sourcefile?: SourceFile   // not returned by worker
    assemblyfile?: SourceFile  // not returned by worker
}

export interface WorkerUnchangedResult {
    unchanged: true;
}

export interface WorkerErrorResult {
    errors: WorkerError[]
    listings?: CodeListingMap
}

export interface WorkerOutputResult<T> {
    output: T
    listings?: CodeListingMap
    symbolmap?: { [sym: string]: number }
    params?: {}
    segments?: Segment[]
    debuginfo?: {} // optional info
}

export interface WorkingStore {
    getFileData(path: string): FileData;
}
