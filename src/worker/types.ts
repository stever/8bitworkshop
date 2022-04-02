import {
    CodeListing,
    SourceLine,
    WorkerErrorResult,
    WorkerOutputResult,
    WorkerUnchangedResult
} from "./interfaces";

export type FileData = string | Uint8Array;

export class SourceFile {
    lines: SourceLine[];
    text: string;
    offset2loc: Map<number, SourceLine>; //{[offset:number]:number};
    line2offset: Map<number, number>; //{[line:number]:number};

    constructor(lines: SourceLine[], text: string) {
        lines = lines || [];

        this.lines = lines;
        this.text = text;
        this.offset2loc = new Map();
        this.line2offset = new Map();

        for (var info of lines) {
            if (info.offset >= 0) {
                // first line wins (is assigned to offset)
                if (!this.offset2loc[info.offset])
                    this.offset2loc[info.offset] = info;
                if (!this.line2offset[info.line])
                    this.line2offset[info.line] = info.offset;
            }
        }
    }

    findLineForOffset(PC: number, lookbehind: number) {
        if (this.offset2loc) {
            for (var i = 0; i <= lookbehind; i++) {
                var loc = this.offset2loc[PC];

                if (loc) {
                    return loc;
                }

                PC--;
            }
        }

        return null;
    }

    lineCount(): number {
        return this.lines.length;
    }
}

export type CodeListingMap = { [path: string]: CodeListing };

export type Segment = { name: string, start: number, size: number, last?: number, type?: string };

export type WorkerResult =
    WorkerErrorResult
    | WorkerOutputResult<any>
    | WorkerUnchangedResult;

export function isOutputResult(result: WorkerResult): result is WorkerOutputResult<any> {
    return ('output' in result);
}
