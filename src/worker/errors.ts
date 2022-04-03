import {WorkerError} from "./interfaces";

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
