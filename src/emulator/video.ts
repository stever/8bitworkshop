import {_setKeyboardEvents} from "./keys";
import {clamp} from "../util";

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
