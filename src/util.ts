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

function toradix(v: number, nd: number, radix: number) {
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

export function getBasePlatform(platform: string): string {
    return 'zx';
}
