import {hex, clamp} from "../util";
import {SourceLocation} from "../worker/types";
import {VirtualList} from "../vlist"
import {_setKeyboardEvents, KeyDef, KeyFlags, Keys} from "./keys";

var _random_state = 1;

export function getNoiseSeed() {
    return _random_state;
}

export function setNoiseSeed(x: number) {
    _random_state = x;
}

export function __createCanvas(doc: HTMLDocument, mainElement: HTMLElement, width: number, height: number): HTMLCanvasElement {
    var canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.classList.add("emuvideo");
    canvas.tabIndex = -1;               // Make it focusable
    mainElement.appendChild(canvas);
    return canvas;
}

type VideoCanvasOptions = { rotate?: number, overscan?: boolean, aspect?: number };

export class RasterVideo {
    mainElement: HTMLElement;
    width: number;
    height: number;
    options: VideoCanvasOptions;

    constructor(mainElement: HTMLElement, width: number, height: number, options?: VideoCanvasOptions) {
        this.mainElement = mainElement;
        this.width = width;
        this.height = height;
        this.options = options;
    }

    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    imageData: ImageData;
    datau32: Uint32Array;
    vcanvas: JQuery;

    paddle_x = 255;
    paddle_y = 255;

    setRotate(rotate: number) {
        var canvas = this.canvas;
        if (rotate) {
            canvas.style.transform = "rotate(" + rotate + "deg)";
            if (canvas.width < canvas.height)
                canvas.style.paddingLeft = canvas.style.paddingRight = "10%";
        } else {
            canvas.style.transform = null;
            canvas.style.paddingLeft = canvas.style.paddingRight = null;
        }
    }

    create(doc?: HTMLDocument) {
        var canvas;
        this.canvas = canvas = __createCanvas(doc || document, this.mainElement, this.width, this.height);
        this.vcanvas = $(canvas);

        if (this.options && this.options.rotate) {
            this.setRotate(this.options.rotate);
        }

        if (this.options && this.options.overscan) {
            this.vcanvas.css('padding', '0px');
        }

        if (this.options && this.options.aspect) {
            console.log(this.options);
            this.vcanvas.css('aspect-ratio', this.options.aspect + "");
        }

        this.ctx = canvas.getContext('2d');
        this.imageData = this.ctx.createImageData(this.width, this.height);
        this.datau32 = new Uint32Array(this.imageData.data.buffer);
    }

    setKeyboardEvents(callback) {
        _setKeyboardEvents(this.canvas, callback);
    }

    getFrameData() {
        return this.datau32;
    }

    getContext() {
        return this.ctx;
    }

    updateFrame(sx?: number, sy?: number, dx?: number, dy?: number, w?: number, h?: number) {
        if (w && h) {
            this.ctx.putImageData(this.imageData, sx, sy, dx, dy, w, h);
        } else {
            this.ctx.putImageData(this.imageData, 0, 0);
        }
    }

    setupMouseEvents(el?: HTMLCanvasElement) {
        if (!el) {
            el = this.canvas;
        }

        $(el).mousemove((e) => {
            var pos = getMousePos(el, e);
            var new_x = Math.floor(pos.x * 255 / this.canvas.width);
            var new_y = Math.floor(pos.y * 255 / this.canvas.height);

            this.paddle_x = clamp(0, 255, new_x);
            this.paddle_y = clamp(0, 255, new_y);
        });
    };
}

export class RAM {
    mem: Uint8Array;

    constructor(size: number) {
        this.mem = new Uint8Array(new ArrayBuffer(size));
    }
}

export class EmuHalt extends Error {
    $loc: SourceLocation;

    constructor(msg: string, loc?: SourceLocation) {
        super(msg);
        this.$loc = loc;
        Object.setPrototypeOf(this, EmuHalt.prototype);
    }
}

export var useRequestAnimationFrame: boolean = false;

export class AnimationTimer {
    callback;
    running: boolean = false;
    pulsing: boolean = false;
    nextts = 0;
    nframes;
    startts; // for FPS calc
    frameRate;
    intervalMsec;
    useReqAnimFrame = useRequestAnimationFrame && typeof window.requestAnimationFrame === 'function'; // need for unit test

    constructor(frequencyHz: number, callback: () => void) {
        this.frameRate = frequencyHz;
        this.intervalMsec = 1000.0 / frequencyHz;
        this.callback = callback;
    }

    scheduleFrame(msec: number) {
        var fn = (timestamp) => {
            try {
                this.nextFrame(this.useReqAnimFrame ? timestamp : Date.now());
            } catch (e) {
                this.running = false;
                this.pulsing = false;
                throw e;
            }
        }

        if (this.useReqAnimFrame) {
            window.requestAnimationFrame(fn);
        } else {
            setTimeout(fn, msec);
        }
    }

    nextFrame(ts: number) {
        if (ts > this.nextts) {
            if (this.running) {
                this.callback();
            }

            if (this.nframes == 0) {
                this.startts = ts;
            }

            if (this.nframes++ == 300) {
                console.log("Avg framerate: " + this.nframes * 1000 / (ts - this.startts) + " fps");
            }
        }

        this.nextts += this.intervalMsec;

        // frames skipped? catch up
        if ((ts - this.nextts) > 1000) {
            //console.log(ts - this.nextts, 'msec skipped');
            this.nextts = ts;
        }

        if (this.running) {
            this.scheduleFrame(this.nextts - ts);
        } else {
            this.pulsing = false;
        }
    }

    isRunning() {
        return this.running;
    }

    start() {
        if (!this.running) {
            this.running = true;
            this.nextts = 0;
            this.nframes = 0;
            if (!this.pulsing) {
                this.scheduleFrame(0);
                this.pulsing = true;
            }
        }
    }

    stop() {
        this.running = false;
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

export function padBytes(data: Uint8Array | number[], len: number, padstart?: boolean): Uint8Array {
    if (data.length > len) {
        throw Error("Data too long, " + data.length + " > " + len);
    }

    var r = new RAM(len);
    if (padstart) {
        r.mem.set(data, len - data.length);
    } else {
        r.mem.set(data);
    }

    return r.mem;
}

// https://stackoverflow.com/questions/17130395/real-mouse-position-in-canvas
export function getMousePos(canvas: HTMLCanvasElement, evt): { x: number, y: number } {
    var rect = canvas.getBoundingClientRect(), // abs. size of element
        scaleX = canvas.width / rect.width,    // relationship bitmap vs. element for X
        scaleY = canvas.height / rect.height;  // relationship bitmap vs. element for Y

    return {
        x: (evt.clientX - rect.left) * scaleX,   // scale mouse coordinates after they have
        y: (evt.clientY - rect.top) * scaleY     // been adjusted to be relative to element
    }
}

// TODO: https://stackoverflow.com/questions/10463518/converting-em-to-px-in-javascript-and-getting-default-font-size
export function getVisibleEditorLineHeight(): number {
    return $("#booksMenuButton").first().height();
}

export interface VirtualTextLine {
    text: string;
    clas?: string;
}

export class VirtualTextScroller {
    memorylist;
    maindiv: HTMLElement;
    getLineAt: (row: number) => VirtualTextLine;

    constructor(parent: HTMLElement) {
        var div = document.createElement('div');
        div.setAttribute("class", "memdump");
        parent.appendChild(div);
        this.maindiv = div;
    }

    create(workspace: HTMLElement, maxRowCount: number, fn: (row: number) => VirtualTextLine) {
        this.getLineAt = fn;

        this.memorylist = new VirtualList({
            w: $(workspace).width(),
            h: $(workspace).height(),
            itemHeight: getVisibleEditorLineHeight(),
            totalRows: maxRowCount,
            generatorFn: (row: number) => {
                var line = fn(row);
                var linediv = document.createElement("div");
                linediv.appendChild(document.createTextNode(line.text));
                if (line.clas != null) linediv.className = line.clas;
                return linediv;
            }
        });

        $(this.maindiv).append(this.memorylist.container);
    }

    refresh() {
        if (this.memorylist) {
            $(this.maindiv).find('[data-index]').each((i, e) => {
                var div = e;
                var row = parseInt(div.getAttribute('data-index'));
                var oldtext = div.innerText;
                var line = this.getLineAt(row);
                var newtext = line.text;

                if (oldtext != newtext) {
                    div.innerText = newtext;
                    if (line.clas != null && !div.classList.contains(line.clas)) {
                        var oldclasses = Array.from(div.classList);
                        oldclasses.forEach((c) => div.classList.remove(c));
                        div.classList.add('vrow');
                        div.classList.add(line.clas);
                    }
                }
            });
        }
    }
}
