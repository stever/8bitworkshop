import {ProjectView} from "../baseviews";
import {platform} from "../ui";
import {ProbeFlags} from "../emulator/recorder";
import {getMousePos} from "../emulator/video";
import {ProbeViewBaseBase} from "./views";

abstract class ProbeViewBase extends ProbeViewBaseBase {
    maindiv: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    recreateOnResize = true;

    abstract drawEvent(op, addr, col, row);

    createCanvas(parent: HTMLElement, width: number, height: number) {
        var div = document.createElement('div');
        var canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;
        canvas.classList.add('pixelated');
        canvas.style.width = '100%';
        canvas.style.height = '90vh'; // i hate css
        canvas.style.backgroundColor = 'black';
        canvas.style.cursor = 'crosshair';

        canvas.onmousemove = (e) => {
            var pos = getMousePos(canvas, e);
            this.showTooltip(this.getTooltipText(pos.x, pos.y));
            $(this.tooldiv).css('left', e.pageX + 10).css('top', e.pageY - 30);
        }

        canvas.onmouseout = (e) => {
            $(this.tooldiv).hide();
        }

        parent.appendChild(div);
        div.appendChild(canvas);

        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.initCanvas();

        return this.maindiv = div;
    }

    initCanvas() {

    }

    getTooltipText(x: number, y: number): string {
        return null;
    }

    clear() {

    }

    tick() {
        this.clear();
        this.redraw(this.drawEvent.bind(this));
    }
}

abstract class ProbeBitmapViewBase extends ProbeViewBase {
    imageData: ImageData;
    datau32: Uint32Array;
    recreateOnResize = false;

    createDiv(parent: HTMLElement) {
        return this.createCanvas(parent, this.cyclesPerLine, this.totalScanlines);
    }

    initCanvas() {
        this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        this.datau32 = new Uint32Array(this.imageData.data.buffer);
    }

    getTooltipText(x: number, y: number): string {
        x = x | 0;
        y = y | 0;

        var s = "";
        var lastroutine = null;
        var symstack = [];
        var lastcol = -1;

        this.redraw((op, addr, col, row, clk, value) => {
            switch (op) {
                case ProbeFlags.EXECUTE:
                    lastroutine = this.addr2symbol(addr) || lastroutine;
                    break;
                case ProbeFlags.SP_PUSH:
                    symstack.push(lastroutine);
                    break;
                case ProbeFlags.SP_POP:
                    lastroutine = symstack.pop();
                    break;
            }

            if (row == y && col <= x) {
                if (col != lastcol) {
                    s = "";
                    lastcol = col;
                }

                if (s == "" && lastroutine) {
                    s += "\n" + lastroutine;
                }

                s += "\n" + this.opToString(op, addr, value);
            }
        });

        return 'X: ' + x + '  Y: ' + y + ' ' + s;
    }

    refresh() {
        this.tick();
        this.datau32.fill(0xff000000);
    }

    tick() {
        super.tick();
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    clear() {
        this.datau32.fill(0xff000000);
    }
}

export class AddressHeatMapView extends ProbeBitmapViewBase implements ProjectView {

    createDiv(parent: HTMLElement) {
        return this.createCanvas(parent, 256, 256);
    }

    clear() {
        for (var i = 0; i <= 0xffff; i++) {
            var v = platform.readAddress(i);
            var rgb = (v >> 2) | (v & 0x1f);
            rgb |= (rgb << 8) | (rgb << 16);
            this.datau32[i] = rgb | 0xff000000;
        }
    }

    drawEvent(op, addr, col, row) {
        var rgb = this.getOpRGB(op);
        if (!rgb) {
            return;
        }

        var data = this.datau32[addr & 0xffff];
        data = data | rgb | 0xff000000;
        this.datau32[addr & 0xffff] = data;
    }

    getTooltipText(x: number, y: number): string {
        var a = (x & 0xff) + (y << 8);
        var s = "";
        var pc = -1;
        var already = {};
        var lastroutine = null;
        var symstack = [];

        this.redraw((op, addr, col, row, clk, value) => {
            switch (op) {
                case ProbeFlags.EXECUTE:
                    pc = addr;
                    lastroutine = this.addr2symbol(addr) || lastroutine;
                    break;
                case ProbeFlags.SP_PUSH:
                    symstack.push(lastroutine);
                    break;
                case ProbeFlags.SP_POP:
                    lastroutine = symstack.pop();
                    break;
            }

            var key = op | pc;
            if (addr == a && !already[key]) {
                if (s == "" && lastroutine) {
                    s += "\n" + lastroutine;
                }
                s += "\nPC " + this.addr2str(pc) + " " + this.opToString(op, null, value);
                already[key] = 1;
            }
        });

        return this.addr2str(a) + s;
    }
}
