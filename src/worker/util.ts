import {WorkerErrorResult} from "./interfaces";

export function errorResult(msg: string): WorkerErrorResult {
    return {errors: [{line: 0, msg: msg}]};
}

export var print_fn = function (s: string) {
    console.log(s);
}
