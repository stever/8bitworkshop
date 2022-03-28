export function lpad(s: string, n: number): string {
    s += ''; // convert to string

    while (s.length < n) {
      s = " " + s;
    }

    return s;
}

export function rpad(s: string, n: number): string {
    s += ''; // convert to string

    while (s.length < n) {
        s += " ";
    }

    return s;
}

export function getFilenameForPath(s: string): string {
    var toks = s.split('/');
    return toks[toks.length - 1];
}

export function getFolderForPath(s: string): string {
    return s.substring(0, s.lastIndexOf('/'));
}

export function getFilenamePrefix(s: string): string {
    var pos = s.lastIndexOf('.');
    return (pos > 0) ? s.substr(0, pos) : s;
}

export function hex(v: number, nd?: number) {
    if (!nd) {
        nd = 2;
    }

    if (nd == 8) {
        return hex((v >> 16) & 0xffff, 4) + hex(v & 0xffff, 4);
    } else {
        return toradix(v, nd, 16);
    }
}

export function toradix(v: number, nd: number, radix: number) {
    try {
        var s = v.toString(radix).toUpperCase();

        while (s.length < nd) {
            s = "0" + s;
        }

        return s;
    } catch (e) {
        return v + "";
    }
}

export function invertMap(m: {}): {} {
    var r = {};

    if (m) {
        for (var k in m) {
            r[m[k]] = k;
        }
    }

    return r;
}

export function isProbablyBinary(path: string, data?: number[] | Uint8Array): boolean {
    var score = 0;

    // check extensions
    if (path) {
        path = path.toUpperCase();
        const BINEXTS = ['.CHR', '.BIN', '.DAT', '.PAL', '.NAM', '.RLE', '.LZ4', '.NSF'];
        for (var ext of BINEXTS) {
            if (path.endsWith(ext)) {
                score++;
            }
        }
    }

    // decode as UTF-8
    for (var i = 0; i < (data ? data.length : 0);) {
        let c = data[i++];
        if ((c & 0x80) == 0) {

            // more likely binary if we see a NUL or obscure control character
            if (c < 9 || (c >= 14 && c < 26) || c == 0x7f) {
                score++;
                break;
            }
        } else {

            // look for invalid unicode sequences
            var nextra = 0;

            if ((c & 0xe0) == 0xc0) {
                nextra = 1;
            } else if ((c & 0xf0) == 0xe0) {
                nextra = 2;
            } else if ((c & 0xf8) == 0xf0) {
                nextra = 3;
            } else if (c < 0xa0) {
                score++;
            } else if (c == 0xff) {
                score++;
            }

            while (nextra--) {
                if (i >= data.length || (data[i++] & 0xc0) != 0x80) {
                    score++;
                    break;
                }
            }
        }
    }

    return score > 0;
}

export function clamp(minv: number, maxv: number, v: number) {
    return (v < minv) ? minv : (v > maxv) ? maxv : v;
}

// firefox doesn't do GET with binary files
export function getWithBinary(url: string, success: (text: string | Uint8Array) => void, datatype: 'text' | 'arraybuffer') {
    var oReq = new XMLHttpRequest();
    oReq.open("GET", url, true);
    oReq.responseType = datatype;

    oReq.onload = function (oEvent) {
        if (oReq.status == 200) {
            var data = oReq.response;

            if (data instanceof ArrayBuffer) {
                data = new Uint8Array(data);
            }

            success(data);
        } else if (oReq.status == 404) {
            success(null);
        } else {
            throw Error("Error " + oReq.status + " loading " + url);
        }
    }

    oReq.onerror = function (oEvent) {
        success(null);
    }

    oReq.ontimeout = function (oEvent) {
        throw Error("Timeout loading " + url);
    }

    oReq.send(null);
}

// get platform ID without . emulator
export function getBasePlatform(platform: string): string {
    return platform.split('.')[0];
}

// get platform ID without - specialization
export function getRootPlatform(platform: string): string {
    return platform.split('-')[0];
}

// get platform ID without emulator or specialization
export function getRootBasePlatform(platform: string): string {
    return getRootPlatform(getBasePlatform(platform));
}

export function isArray(obj: any): obj is ArrayLike<any> {
    return obj != null && (Array.isArray(obj) || isTypedArray(obj));
}

export function isTypedArray(obj: any): obj is ArrayLike<number> {
    return obj != null && obj['BYTES_PER_ELEMENT'];
}

export function decodeQueryString(qs: string): {} {
    if (qs.startsWith('?')) qs = qs.substr(1);
    var a = qs.split('&');

    if (!a || a.length == 0) {
        return {};
    }

    var b = {};
    for (var i = 0; i < a.length; ++i) {
        var p = a[i].split('=', 2);

        if (p.length == 1) {
            b[p[0]] = "";
        } else {
            b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, " "));
        }
    }

    return b;
}

export class FileDataCache {
    maxSize: number = 8000000;
    size: number;
    cache: Map<string, string | Uint8Array>;

    constructor() {
        this.reset();
    }

    get(key: string): string | Uint8Array {
        return this.cache.get(key);
    }

    put(key: string, value: string | Uint8Array) {
        this.cache.set(key, value);
        this.size += value.length;

        if (this.size > this.maxSize) {
            console.log('cache reset', this);
            this.reset();
        }
    }

    reset() {
        this.cache = new Map();
        this.size = 0;
    }
}
