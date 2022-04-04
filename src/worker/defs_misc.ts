import {FileData} from "./defs_files";

export interface Dependency {
    path: string
    filename: string
    link: boolean
    data: FileData
}

/// <reference types="emscripten" />
export interface EmscriptenModule {
    callMain?: (args: string[]) => void
    FS: any
}
