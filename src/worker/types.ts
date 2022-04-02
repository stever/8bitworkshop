import {
    CodeListing,
    WorkerErrorResult,
    WorkerOutputResult,
    WorkerUnchangedResult
} from "./interfaces";

export type FileData = string | Uint8Array;

export type CodeListingMap = { [path: string]: CodeListing };

export type Segment = { name: string, start: number, size: number, last?: number, type?: string };

export type WorkerResult = WorkerErrorResult | WorkerOutputResult<any> | WorkerUnchangedResult;
