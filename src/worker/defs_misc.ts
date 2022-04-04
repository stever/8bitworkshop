import {SourceFile} from "./SourceFile";

export type FileData = string | Uint8Array;

export type CodeListingMap = { [path: string]: CodeListing };

export type Segment = { name: string, start: number, size: number, last?: number, type?: string };

export type FileEntry = {
    path: string
    encoding: string
    data: FileData
    ts: number
};

export interface SourceLocation {
    line: number
    label?: string
    path?: string
    start?: number
    end?: number
    segment?: string
    func?: string
}

export interface SourceSnippet extends SourceLocation {
    offset: number
    insns?: string
    iscode?: boolean
    cycles?: number
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

export interface PlatformParams {
    arch: string
    code_start: number
    rom_size: number
    data_start: number
    data_size: number
    stack_end: number
    extra_link_args: string[]
    extra_link_files: string[]
}

export interface WorkerItemUpdate {
    key: string
    value: object
}

export interface CodeListing {
    lines: SourceSnippet[]
    asmlines?: SourceSnippet[]
    text?: string
    sourcefile?: SourceFile // not returned by worker
    assemblyfile?: SourceFile // not returned by worker
}

export interface WorkingStore {
    getFileData(path: string): FileData
}

/// <reference types="emscripten" />
export interface EmscriptenModule {
    callMain?: (args: string[]) => void
    FS: any
}
