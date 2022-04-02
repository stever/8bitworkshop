import {WorkerErrorResult} from "./interfaces";

export function errorResult(msg: string): WorkerErrorResult {
    return {errors: [{line: 0, msg: msg}]};
}
