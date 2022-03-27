import {hex} from "../util";

export class RAM {
    mem: Uint8Array;

    constructor(size: number) {
        this.mem = new Uint8Array(new ArrayBuffer(size));
    }
}

export function dumpRAM(ram: ArrayLike<number>, ramofs: number, ramlen: number): string {
    var s = "";
    var bpel = ram['BYTES_PER_ELEMENT'] || 1;
    var perline = Math.ceil(16 / bpel);
    var isFloat = ram instanceof Float32Array || ram instanceof Float64Array;

    for (var ofs = 0; ofs < ramlen; ofs += perline) {
        s += '$' + hex(ofs + ramofs) + ':';

        for (var i = 0; i < perline; i++) {
            if (ofs + i < ram.length) {
                if (i == perline / 2) {
                    s += " ";
                }

                if (isFloat) {
                    s += " " + ram[ofs + i].toPrecision(bpel * 2);
                } else {
                    s += " " + hex(ram[ofs + i], bpel * 2);
                }
            }
        }

        s += "\n";
    }

    return s;
}
