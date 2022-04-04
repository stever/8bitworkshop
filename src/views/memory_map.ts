import {newDiv, ProjectView} from "../baseviews";
import {Segment} from "../worker/defs_misc";
import {hex} from "../util";
import {current_project, projectWindows} from "../ui";
import {MemoryView} from "./memory_browser";

export class MemoryMapView implements ProjectView {
    maindiv: JQuery;

    createDiv(parent: HTMLElement) {
        this.maindiv = newDiv(parent, 'vertical-scroll');
        this.maindiv.css('display', 'grid');
        this.maindiv.css('grid-template-columns', '5em 40% 40%');
        return this.maindiv[0];
    }

    addSegment(seg: Segment, newrow: boolean) {
        if (newrow) {
            var offset = $('<div class="segment-offset" style="grid-column-start:1"/>');
            offset.text('$' + hex(seg.start, 4));
            this.maindiv.append(offset);
        }

        var segdiv = $('<div class="segment"/>');

        if (!newrow) {
            segdiv.css('grid-column-start', 3); // make sure it's on right side
        }

        if (seg.last) {
            segdiv.text(seg.name + " (" + (seg.last - seg.start) + " / " + seg.size + " bytes used)");
        } else {
            segdiv.text(seg.name + " (" + seg.size + " bytes)");
        }

        if (seg.size >= 256) {
            var pad = (Math.log(seg.size) - Math.log(256)) * 0.5;
            segdiv.css('padding-top', pad + 'em');
            segdiv.css('padding-bottom', pad + 'em');
        }

        if (seg.type) {
            segdiv.addClass('segment-' + seg.type);
        }

        this.maindiv.append(segdiv);

        segdiv.click(() => {
            var memview = projectWindows.createOrShow('#memory') as MemoryView;
            memview.scrollToAddress(seg.start);
        });
    }

    refresh() {
        this.maindiv.empty();

        var segments = current_project.segments;
        if (segments) {
            var curofs = 0;
            var laststart = -1;

            for (var seg of segments) {
                if (seg.start > curofs) {
                    this.addSegment({
                        name: '',
                        start: curofs,
                        size: seg.start - curofs
                    }, true);
                }

                this.addSegment(seg, laststart != seg.start);
                laststart = seg.start;
                curofs = seg.start + seg.size;
            }
        }
    }
}
