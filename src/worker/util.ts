import {BuildStep, WorkerErrorResult} from "./interfaces";

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
