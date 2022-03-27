import {hex, clamp} from "../util";
import {SourceLocation} from "../worker/types";
import {VirtualList} from "../vlist"

var _random_state = 1;

export function getNoiseSeed() {
    return _random_state;
}

export function setNoiseSeed(x: number) {
    _random_state = x;
}

type KeyboardCallback = (which: number, charCode: number, flags: KeyFlags) => void;

export function __createCanvas(doc: HTMLDocument, mainElement: HTMLElement, width: number, height: number): HTMLCanvasElement {
    var canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.classList.add("emuvideo");
    canvas.tabIndex = -1;               // Make it focusable
    mainElement.appendChild(canvas);
    return canvas;
}

export enum KeyFlags {
    KeyDown = 1,
    Shift = 2,
    Ctrl = 4,
    Alt = 8,
    Meta = 16,
    KeyUp = 64,
    KeyPress = 128,
}

export function _setKeyboardEvents(canvas: HTMLElement, callback: KeyboardCallback) {
    canvas.onkeydown = (e) => {
        callback(e.which, 0, KeyFlags.KeyDown | _metakeyflags(e));
        if (e.ctrlKey || e.which == 8 || e.which == 9 || e.which == 27) { // eat backspace, tab, escape keys
            e.preventDefault();
        }
    };

    canvas.onkeyup = (e) => {
        callback(e.which, 0, KeyFlags.KeyUp | _metakeyflags(e));
    };

    canvas.onkeypress = (e) => {
        callback(e.which, e.charCode, KeyFlags.KeyPress | _metakeyflags(e));
    };
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

export interface KeyDef {
    c: number,	// key code
    n: string,	// name
    // for gamepad
    plyr?: number,
    xaxis?: number,
    yaxis?: number,
    button?: number
};

export const Keys = {
    ANYKEY: {c: 0, n: "?"},
    // gamepad and keyboard (player 0)
    UP: {c: 38, n: "Up", plyr: 0, yaxis: -1},
    DOWN: {c: 40, n: "Down", plyr: 0, yaxis: 1},
    LEFT: {c: 37, n: "Left", plyr: 0, xaxis: -1},
    RIGHT: {c: 39, n: "Right", plyr: 0, xaxis: 1},
    A: {c: 32, n: "Space", plyr: 0, button: 0},
    B: {c: 16, n: "Shift", plyr: 0, button: 1},
    GP_A: {c: 88, n: "X", plyr: 0, button: 0},
    GP_B: {c: 90, n: "Z", plyr: 0, button: 1},
    GP_C: {c: 86, n: "V", plyr: 0, button: 2},
    GP_D: {c: 67, n: "C", plyr: 0, button: 3},
    SELECT: {c: 220, n: "\\", plyr: 0, button: 8},
    START: {c: 13, n: "Enter", plyr: 0, button: 9},
    // gamepad and keyboard (player 1)
    P2_UP: {c: 87, n: "W", plyr: 1, yaxis: -1},
    P2_DOWN: {c: 83, n: "S", plyr: 1, yaxis: 1},
    P2_LEFT: {c: 65, n: "A", plyr: 1, xaxis: -1},
    P2_RIGHT: {c: 68, n: "D", plyr: 1, xaxis: 1},
    P2_A: {c: 84, n: "T", plyr: 1, button: 0},
    P2_B: {c: 82, n: "R", plyr: 1, button: 1},
    P2_GP_A: {c: 69, n: "E", plyr: 1, button: 0},
    P2_GP_B: {c: 82, n: "R", plyr: 1, button: 1},
    P2_GP_C: {c: 84, n: "T", plyr: 1, button: 2},
    P2_GP_D: {c: 89, n: "Y", plyr: 1, button: 3},
    P2_SELECT: {c: 70, n: "F", plyr: 1, button: 8},
    P2_START: {c: 71, n: "G", plyr: 1, button: 9},
    // keyboard only
    VK_ESCAPE: {c: 27, n: "Esc"},
    VK_F1: {c: 112, n: "F1"},
    VK_F2: {c: 113, n: "F2"},
    VK_F3: {c: 114, n: "F3"},
    VK_F4: {c: 115, n: "F4"},
    VK_F5: {c: 116, n: "F5"},
    VK_F6: {c: 117, n: "F6"},
    VK_F7: {c: 118, n: "F7"},
    VK_F8: {c: 119, n: "F8"},
    VK_F9: {c: 120, n: "F9"},
    VK_F10: {c: 121, n: "F10"},
    VK_F11: {c: 122, n: "F11"},
    VK_F12: {c: 123, n: "F12"},
    VK_SCROLL_LOCK: {c: 145, n: "ScrLck"},
    VK_PAUSE: {c: 19, n: "Pause"},
    VK_QUOTE: {c: 192, n: "'"},
    VK_1: {c: 49, n: "1"},
    VK_2: {c: 50, n: "2"},
    VK_3: {c: 51, n: "3"},
    VK_4: {c: 52, n: "4"},
    VK_5: {c: 53, n: "5"},
    VK_6: {c: 54, n: "6"},
    VK_7: {c: 55, n: "7"},
    VK_8: {c: 56, n: "8"},
    VK_9: {c: 57, n: "9"},
    VK_0: {c: 48, n: "0"},
    VK_MINUS: {c: 189, n: "-"},
    VK_MINUS2: {c: 173, n: "-"},
    VK_EQUALS: {c: 187, n: "="},
    VK_EQUALS2: {c: 61, n: "="},
    VK_BACK_SPACE: {c: 8, n: "Bkspc"},
    VK_TAB: {c: 9, n: "Tab"},
    VK_Q: {c: 81, n: "Q"},
    VK_W: {c: 87, n: "W"},
    VK_E: {c: 69, n: "E"},
    VK_R: {c: 82, n: "R"},
    VK_T: {c: 84, n: "T"},
    VK_Y: {c: 89, n: "Y"},
    VK_U: {c: 85, n: "U"},
    VK_I: {c: 73, n: "I"},
    VK_O: {c: 79, n: "O"},
    VK_P: {c: 80, n: "P"},
    VK_ACUTE: {c: 219, n: "´"},
    VK_OPEN_BRACKET: {c: 221, n: "["},
    VK_CLOSE_BRACKET: {c: 220, n: "]"},
    VK_CAPS_LOCK: {c: 20, n: "CpsLck"},
    VK_A: {c: 65, n: "A"},
    VK_S: {c: 83, n: "S"},
    VK_D: {c: 68, n: "D"},
    VK_F: {c: 70, n: "F"},
    VK_G: {c: 71, n: "G"},
    VK_H: {c: 72, n: "H"},
    VK_J: {c: 74, n: "J"},
    VK_K: {c: 75, n: "K"},
    VK_L: {c: 76, n: "L"},
    VK_CEDILLA: {c: 186, n: "Ç"},
    VK_TILDE: {c: 222, n: "~"},
    VK_ENTER: {c: 13, n: "Enter"},
    VK_SHIFT: {c: 16, n: "Shift"},
    VK_BACK_SLASH: {c: 226, n: "\\"},
    VK_Z: {c: 90, n: "Z"},
    VK_X: {c: 88, n: "X"},
    VK_C: {c: 67, n: "C"},
    VK_V: {c: 86, n: "V"},
    VK_B: {c: 66, n: "B"},
    VK_N: {c: 78, n: "N"},
    VK_M: {c: 77, n: "M"},
    VK_COMMA: {c: 188, n: "] ="},
    VK_PERIOD: {c: 190, n: "."},
    VK_SEMICOLON: {c: 191, n: ";"},
    VK_SLASH: {c: 193, n: "/"},
    VK_CONTROL: {c: 17, n: "Ctrl"},
    VK_ALT: {c: 18, n: "Alt"},
    VK_SPACE: {c: 32, n: "Space"},
    VK_INSERT: {c: 45, n: "Ins"},
    VK_DELETE: {c: 46, n: "Del"},
    VK_HOME: {c: 36, n: "Home"},
    VK_END: {c: 35, n: "End"},
    VK_PAGE_UP: {c: 33, n: "PgUp"},
    VK_PAGE_DOWN: {c: 34, n: "PgDown"},
    VK_UP: {c: 38, n: "Up"},
    VK_DOWN: {c: 40, n: "Down"},
    VK_LEFT: {c: 37, n: "Left"},
    VK_RIGHT: {c: 39, n: "Right"},
    VK_NUM_LOCK: {c: 144, n: "Num"},
    VK_DIVIDE: {c: 111, n: "Num /"},
    VK_MULTIPLY: {c: 106, n: "Num *"},
    VK_SUBTRACT: {c: 109, n: "Num -"},
    VK_ADD: {c: 107, n: "Num +"},
    VK_DECIMAL: {c: 194, n: "Num ."},
    VK_NUMPAD0: {c: 96, n: "Num 0"},
    VK_NUMPAD1: {c: 97, n: "Num 1"},
    VK_NUMPAD2: {c: 98, n: "Num 2"},
    VK_NUMPAD3: {c: 99, n: "Num 3"},
    VK_NUMPAD4: {c: 100, n: "Num 4"},
    VK_NUMPAD5: {c: 101, n: "Num 5"},
    VK_NUMPAD6: {c: 102, n: "Num 6"},
    VK_NUMPAD7: {c: 103, n: "Num 7"},
    VK_NUMPAD8: {c: 104, n: "Num 8"},
    VK_NUMPAD9: {c: 105, n: "Num 9"},
    VK_NUMPAD_CENTER: {c: 12, n: "Num Cntr"}
};

function _metakeyflags(e) {
    return (e.shiftKey ? KeyFlags.Shift : 0) |
        (e.ctrlKey ? KeyFlags.Ctrl : 0) |
        (e.altKey ? KeyFlags.Alt : 0) |
        (e.metaKey ? KeyFlags.Meta : 0);
}

const DEFAULT_CONTROLLER_KEYS: KeyDef[] = [
    Keys.UP, Keys.DOWN, Keys.LEFT, Keys.RIGHT, Keys.A, Keys.B, Keys.SELECT, Keys.START,
    Keys.P2_UP, Keys.P2_DOWN, Keys.P2_LEFT, Keys.P2_RIGHT, Keys.P2_A, Keys.P2_B, Keys.P2_SELECT, Keys.P2_START,
];

export class ControllerPoller {
    active = false;
    handler;
    state = new Int8Array(32);
    lastState = new Int8Array(32);
    AXIS0 = 24; // first joystick axis index

    constructor(handler: (key, code, flags) => void) {
        this.handler = handler;

        window.addEventListener("gamepadconnected", (event) => {
            console.log("Gamepad connected:", event);
            this.active = typeof navigator.getGamepads === 'function';
        });

        window.addEventListener("gamepaddisconnected", (event) => {
            console.log("Gamepad disconnected:", event);
        });
    }

    poll() {
        if (!this.active) {
            return;
        }

        var gamepads = navigator.getGamepads();

        for (var gpi = 0; gpi < gamepads.length; gpi++) {
            var gp = gamepads[gpi];
            if (gp) {
                for (var i = 0; i < gp.axes.length; i++) {
                    var k = i + this.AXIS0;
                    this.state[k] = Math.round(gp.axes[i]);
                    if (this.state[k] != this.lastState[k]) {
                        this.handleStateChange(gpi, k);
                    }
                }

                for (var i = 0; i < gp.buttons.length; i++) {
                    this.state[i] = gp.buttons[i].pressed ? 1 : 0;
                    if (this.state[i] != this.lastState[i]) {
                        this.handleStateChange(gpi, i);
                    }
                }

                this.lastState.set(this.state);
            }
        }
    }

    handleStateChange(gpi: number, k: number) {
        var axis = k - this.AXIS0;
        for (var def of DEFAULT_CONTROLLER_KEYS) {

            // is this a gamepad entry? same player #?
            if (def && def.plyr == gpi) {
                var code = def.c;
                var state = this.state[k];
                var lastState = this.lastState[k];

                // check for button/axis match
                if (k == def.button || (axis == 0 && def.xaxis == state) || (axis == 1 && def.yaxis == state)) {
                    //console.log(gpi,k,state,entry);

                    if (state != 0) {
                        this.handler(code, 0, KeyFlags.KeyDown);
                    } else {
                        this.handler(code, 0, KeyFlags.KeyUp);
                    }

                    break;

                    // joystick released?
                } else if (state == 0 && (axis == 0 && def.xaxis == lastState) || (axis == 1 && def.yaxis == lastState)) {
                    this.handler(code, 0, KeyFlags.KeyUp);
                    break;
                }
            }
        }
    }
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
