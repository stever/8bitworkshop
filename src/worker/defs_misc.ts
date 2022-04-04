export type FileData = string | Uint8Array;

export type FileEntry = {
    path: string
    encoding: string
    data: FileData
    ts: number
};

export interface Dependency {
    path: string
    filename: string
    link: boolean
    data: FileData
}

export interface WorkingStore {
    getFileData(path: string): FileData
}

/// <reference types="emscripten" />
export interface EmscriptenModule {
    callMain?: (args: string[]) => void
    FS: any
}
