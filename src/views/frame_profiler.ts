import {ProbeViewBaseBase} from "./views";
import {ProjectView} from "../baseviews";
import {ProbeFlags} from "../emulator/recorder";
import {createTreeRootNode, TreeNode} from "../treeviews";

export class FrameCallsView extends ProbeViewBaseBase implements ProjectView {
    treeroot: TreeNode;

    createDiv(parent: HTMLElement): HTMLElement {
        this.treeroot = createTreeRootNode(parent, this);
        return this.treeroot.getDiv();
    }

    refresh() {
        this.tick();
    }

    tick() {
        this.treeroot.update(this.getRootObject());
    }

    getRootObject(): Object {
        var frame = {};

        this.redraw((op, addr, col, row, clk, value) => {
            switch (op) {
                case ProbeFlags.EXECUTE:
                    let sym = this.addr2symbol(addr);
                    if (sym) {
                        if (!frame[sym]) {
                            frame[sym] = row;
                        }
                    }
                    break;
            }
        });

        return frame;
    }
}
