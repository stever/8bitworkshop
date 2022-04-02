import {FileData, WorkingStore} from "./worker/types";

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

// remote resource cache
var $$cache = new FileDataCache();

// file read/write interface
var $$store: WorkingStore;

// backing store for data
var $$data: {} = {};

// module cache
var $$modules: Map<string, {}> = new Map();

// object that can load state from backing store
export interface Loadable {

    // called during script, from io.data.load()
    $$setstate?(newstate: {}): void;

    // called after script, from io.data.save()
    $$getstate(): {};
}

export namespace data {
    export function load(object: Loadable, key: string): Loadable {
        if (object == null) return object;
        let override = $$data && $$data[key];
        if (override && object.$$setstate) {
            object.$$setstate(override);
        } else if (override) {
            Object.assign(object, override);
        }
        return object;
    }

    export function save(object: Loadable, key: string): Loadable {
        if ($$data && object && object.$$getstate) {
            $$data[key] = object.$$getstate();
        }
        return object;
    }

    export function get(key: string) {
        return $$data && $$data[key];
    }

    export function set(key: string, value: object) {
        if ($$data) {
            $$data[key] = value;
        }
    }
}

export function canonicalurl(url: string): string {
    // get raw resource URL for github
    if (url.startsWith('https://github.com/')) {
        let toks = url.split('/');
        if (toks[5] === 'blob') {
            return `https://raw.githubusercontent.com/${toks[3]}/${toks[4]}/${toks.slice(6).join('/')}`
        }
    }

    return url;
}

export function fetchurl(url: string, type?: 'binary' | 'text'): FileData {
    var xhr = new XMLHttpRequest();
    xhr.responseType = type === 'text' ? 'text' : 'arraybuffer';
    xhr.open("GET", url, false);  // synchronous request
    xhr.send(null);

    if (xhr.response != null && xhr.status == 200) {
        if (type === 'text') {
            return xhr.response as string;
        } else {
            return new Uint8Array(xhr.response);
        }
    } else {
        throw new Error(`The resource at "${url}" responded with status code of ${xhr.status}.`)
    }
}

export function readnocache(url: string, type?: 'binary' | 'text'): FileData {
    if (url.startsWith('http:') || url.startsWith('https:')) {
        return fetchurl(url, type);
    }

    if ($$store) {
        return $$store.getFileData(url);
    }
}

export function read(url: string, type?: 'binary' | 'text'): FileData {
    // canonical-ize url
    url = canonicalurl(url);

    // check cache first
    let cachekey = url;
    let data = $$cache.get(cachekey);
    if (data != null) return data;

    // not in cache, read it
    data = readnocache(url, type);
    if (data == null) throw new Error(`Cannot find resource "${url}"`);
    if (type === 'text' && typeof data !== 'string') throw new Error(`Resource "${url}" is not a string`);
    if (type === 'binary' && !(data instanceof Uint8Array)) throw new Error(`Resource "${url}" is not a binary file`);

    // store in cache
    $$cache.put(cachekey, data);
    return data;
}

export function module(url: string) {
    // find module in cache?
    let key = `${url}::${url.length}`;
    let exports = $$modules.get(key);

    if (exports == null) {
        let code = readnocache(url, 'text') as string;
        let func = new Function('exports', 'module', code);
        let module = {};
        exports = {};
        func(exports, module);
        $$modules.set(key, exports);
    }

    return exports;
}
