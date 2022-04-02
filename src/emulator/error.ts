import {SourceLocation} from "../worker/interfaces";

export class EmuHalt extends Error {
    $loc: SourceLocation;

    constructor(msg: string, loc?: SourceLocation) {
        super(msg);
        this.$loc = loc;
        Object.setPrototypeOf(this, EmuHalt.prototype);
    }
}
