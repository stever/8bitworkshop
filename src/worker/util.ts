import {BuildStep, WorkerError, WorkerErrorResult} from "./interfaces";

export function errorResult(msg: string): WorkerErrorResult {
    return {errors: [{line: 0, msg: msg}]};
}

export var print_fn = function (s: string) {
    console.log(s);
}

export function execMain(step: BuildStep, mod, args: string[]) {
    const run = mod.callMain || mod.run;
    run(args);
}

export function makeErrorMatcher(
    errors: WorkerError[],
    regex,
    iline: number,
    imsg: number,
    mainpath: string,
    ifilename?: number) {

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
