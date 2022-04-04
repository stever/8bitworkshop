import {
    CodeListingMap,
    Segment,
    SourceLocation
} from "./defs_misc";

export interface WorkerOutputResult<T> {
    output: T
    listings?: CodeListingMap
    symbolmap?: { [sym: string]: number }
    params?: {}
    segments?: Segment[]
    debuginfo?: {} // optional info
}

export interface WorkerUnchangedResult {
    unchanged: true
}

export type WorkerResult = WorkerErrorResult | WorkerOutputResult<any> | WorkerUnchangedResult;

export interface WorkerNextToolResult {
    nexttool?: string
    linktool?: string
    path?: string
    args: string[]
    files: string[]
}

export type BuildStepResult = WorkerResult | WorkerNextToolResult;

export interface WorkerError extends SourceLocation {
    msg: string
}

export interface WorkerErrorResult {
    errors: WorkerError[]
}
