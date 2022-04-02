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
