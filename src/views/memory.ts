import {newDiv, ProjectView} from "../baseviews";
import {current_project, platform, projectWindows} from "../ui";
import {hex} from "../util";
import {Segment} from "../worker/types";
import {
    VirtualTextLine,
    VirtualTextScroller
} from "./views";
import {MemoryView} from "./memory_browser";

export class VRAMMemoryView extends MemoryView {
    totalRows = 0x800;

    readAddress(n: number) {
        return platform.readVRAMAddress(n);
    }

    getMemorySegment(a: number): string {
        return 'video';
    }

    getDumpLines() {
        return null;
    }
}

export class BinaryFileView implements ProjectView {
    vlist: VirtualTextScroller;
    maindiv: HTMLElement;
    path: string;
    data: Uint8Array;
    recreateOnResize = true;

    constructor(path: string, data: Uint8Array) {
        this.path = path;
        this.data = data;
    }

    createDiv(parent: HTMLElement) {
        this.vlist = new VirtualTextScroller(parent);
        this.vlist.create(parent, ((this.data.length + 15) >> 4), this.getMemoryLineAt.bind(this));
        return this.vlist.maindiv;
    }

    getMemoryLineAt(row: number): VirtualTextLine {
        var offset = row * 16;
        var n1 = 0;
        var n2 = 16;
        var s = hex(offset + n1, 4) + ' ';

        for (var i = 0; i < n1; i++) {
            s += '   ';
        }

        if (n1 > 8) {
            s += ' ';
        }

        for (var i = n1; i < n2; i++) {
            var read = this.data[offset + i];
            if (i == 8) s += ' ';
            s += ' ' + (read >= 0 ? hex(read, 2) : '  ');
        }

        return {text: s};
    }

    refresh() {
        this.vlist.refresh();
    }

    getPath() {
        return this.path;
    }
}
