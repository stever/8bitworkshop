import type {WorkerResult} from "./types";
import {BuildStep, SourceLine, WorkerError, WorkerMessage} from "./interfaces";
import {Builder} from "./Builder";
import {TOOL_PRELOADFS} from "./global_vars";
import {errorResult} from "./util";
import {fsMeta, loadFilesystem, store} from "./files";

declare function postMessage(msg);

/// working file store and build steps

const builder = new Builder();

export function execMain(step: BuildStep, mod, args: string[]) {
    const run = mod.callMain || mod.run;
    run(args);
}

export var print_fn = function (s: string) {
    console.log(s);
}

// test.c(6) : warning 85: in function main unreferenced local variable : 'x'
// main.a (4): error: Unknown Mnemonic 'xxx'.
// at 2: warning 190: ISO C forbids an empty source file
export const re_msvc = /[/]*([^( ]+)\s*[(](\d+)[)]\s*:\s*(.+?):\s*(.*)/;
export const re_msvc2 = /\s*(at)\s+(\d+)\s*(:)\s*(.*)/;

export function msvcErrorMatcher(errors: WorkerError[]) {
    return function (s: string) {
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
    }
}

export function makeErrorMatcher(errors: WorkerError[], regex, iline: number, imsg: number, mainpath: string, ifilename?: number) {
    return function (s) {
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
    }
}

export function extractErrors(regex, strings: string[], path: string, iline, imsg, ifilename) {
    const errors = [];
    const matcher = makeErrorMatcher(errors, regex, iline, imsg, path, ifilename);

    for (let i = 0; i < strings.length; i++) {
        matcher(strings[i]);
    }

    return errors;
}

export const re_crlf = /\r?\n/;
export const re_lineoffset = /\s*(\d+)\s+[%]line\s+(\d+)\+(\d+)\s+(.+)/;

export function parseListing(code: string,
                             lineMatch, iline: number, ioffset: number, iinsns: number, icycles?: number,
                             funcMatch?, segMatch?): SourceLine[] {

    const lines: SourceLine[] = [];

    let lineofs = 0;
    let segment = '';
    let func = '';
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
            const cycles: number = icycles ? parseInt(linem[icycles]) : null;
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

export function parseSourceLines(code: string, lineMatch, offsetMatch, funcMatch?, segMatch?) {
    const lines = [];

    let lastlinenum = 0;
    let segment = '';
    let func = '';
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

export function setupStdin(fs, code: string) {
    let i = 0;
    fs.init(
        function () {
            return i < code.length ? code.charCodeAt(i++) : null;
        }
    );
}

async function handleMessage(data: WorkerMessage): Promise<WorkerResult> {

    // preload file system
    if (data.preload) {
        let fs = TOOL_PRELOADFS[data.preload];

        if (!fs && data.platform) {
            fs = TOOL_PRELOADFS[data.preload + '-zx'];
        }

        if (!fs && data.platform) {
            fs = TOOL_PRELOADFS[data.preload + '-zx'];
        }

        if (fs && !fsMeta[fs]) {
            loadFilesystem(fs);
        }

        return;
    }

    // clear filesystem?
    if (data.reset) {
        store.reset();
        return;
    }

    return builder.handleMessage(data);
}

let lastpromise = null;

onmessage = async function (e) {
    await lastpromise; // wait for previous message to complete
    lastpromise = handleMessage(e.data);
    const result = await lastpromise;
    lastpromise = null;

    if (result) {
        try {
            postMessage(result);
        } catch (e) {
            console.log(e);
            postMessage(errorResult(`${e}`));
        }
    }
}
