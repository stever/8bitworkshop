import {ProjectView} from "../baseviews";
import {platform} from "../ui";
import {createTreeRootNode, TreeNode} from "../treeviews";

export abstract class TreeViewBase implements ProjectView {
    root: TreeNode;

    createDiv(parent: HTMLElement): HTMLElement {
        this.root = createTreeRootNode(parent, this);
        return this.root.getDiv();
    }

    refresh() {
        this.tick();
    }

    tick() {
        this.root.update(this.getRootObject());
    }

    abstract getRootObject(): Object;
}

export class DebugBrowserView extends TreeViewBase implements ProjectView {
    getRootObject() {
        return platform.getDebugTree();
    }
}
