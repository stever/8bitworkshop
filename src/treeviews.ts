import {dumpRAM} from "./emulator/ram";
import {hex} from "./util";
import {ProjectView} from "./baseviews";

const MAX_CHILDREN = 256;
const MAX_STRING_LEN = 100;

var TREE_SHOW_DOLLAR_IDENTS = false;

export class TreeNode {
    parent: TreeNode;
    name: string;
    _div: HTMLElement;
    _header: HTMLElement;
    _inline: HTMLElement;
    _content: HTMLElement;
    children: Map<string, TreeNode>;
    expanded = false;
    level: number;
    view: ProjectView;

    constructor(parent: TreeNode, name: string) {
        this.parent = parent;
        this.name = name;
        this.children = new Map();
        this.level = parent ? (parent.level + 1) : -1;
        this.view = parent ? parent.view : null;
    }

    getDiv() {
        if (this._div == null) {
            this._div = document.createElement("div");
            this._div.classList.add("vertical-scroll");
            this._div.classList.add("tree-content");
            this._header = document.createElement("div");
            this._header.classList.add("tree-header");
            this._header.classList.add("tree-level-" + this.level);
            this._header.append(this.name);
            this._inline = document.createElement("span");
            this._inline.classList.add("tree-value");
            this._header.append(this._inline);
            this._div.append(this._header);
            this.parent._content.append(this._div);
            this._header.onclick = (e) => {
                this.toggleExpanded();
            };
        }

        if (this.expanded && this._content == null) {
            this._content = document.createElement("div");
            this._div.append(this._content);
        } else if (!this.expanded && this._content != null) {
            this._content.remove();
            this._content = null;
            this.children.clear();
        }

        return this._div;
    }

    toggleExpanded() {
        this.expanded = !this.expanded;
        this.view.tick();
    }

    remove() {
        this._div.remove();
        this._div = null;
    }

    update(obj: any) {
        this.getDiv();
        var text = "";

        // is it a function? call it first, if we are expanded
        if (obj && obj.$$ && typeof obj.$$ == 'function' && this._content != null) {
            obj = obj.$$();
        }

        // check null first
        if (obj == null) {
            text = obj + "";

            // primitive types
        } else if (typeof obj == 'number') {
            if (obj != (obj | 0)) text = obj.toString(); // must be a float
            else text = obj + "\t($" + hex(obj) + ")";
        } else if (typeof obj == 'boolean') {
            text = obj.toString();
        } else if (typeof obj == 'string') {
            if (obj.length < MAX_STRING_LEN)
                text = obj;
            else
                text = obj.substring(0, MAX_STRING_LEN) + "...";
            // typed byte array
        } else if (obj.buffer && obj.length <= MAX_CHILDREN) {
            text = dumpRAM(obj, 0, obj.length);
            // recurse into object? (or function)
        } else if (typeof obj == 'object' || typeof obj == 'function') {
            // only if expanded
            if (this._content != null) {
                // split big arrays
                if (obj.slice && obj.length > MAX_CHILDREN) {
                    let newobj = {};
                    let oldobj = obj;
                    var slicelen = MAX_CHILDREN;

                    while (obj.length / slicelen > MAX_CHILDREN) {
                        slicelen *= 2;
                    }

                    for (let ofs = 0; ofs < oldobj.length; ofs += slicelen) {
                        newobj["$" + hex(ofs)] = {
                            $$: () => {
                                return oldobj.slice(ofs, ofs + slicelen);
                            }
                        }
                    }

                    obj = newobj;
                }

                // get object keys
                let names = obj instanceof Array ? Array.from(obj.keys()) : Object.getOwnPropertyNames(obj);
                if (names.length > MAX_CHILDREN) { // max # of child objects
                    let newobj = {};
                    let oldobj = obj;
                    var slicelen = 100;

                    while (names.length / slicelen > 100) {
                        slicelen *= 2;
                    }

                    for (let ofs = 0; ofs < names.length; ofs += slicelen) {
                        var newdict = {};
                        for (var i = ofs; i < ofs + slicelen; i++) {
                            newdict[names[i]] = oldobj[names[i]];
                        }

                        newobj["[" + ofs + "...]"] = newdict;
                    }

                    obj = newobj;
                    names = Object.getOwnPropertyNames(obj);
                }

                // track deletions
                let orphans = new Set(this.children.keys());

                // visit all children
                names.forEach((name) => {

                    // hide $xxx idents?
                    var hidden = !TREE_SHOW_DOLLAR_IDENTS && typeof name === 'string' && name.startsWith("$$");
                    if (!hidden) {
                        let childnode = this.children.get(name);
                        if (childnode == null) {
                            childnode = new TreeNode(this, name);
                            this.children.set(name, childnode);
                        }

                        childnode.update(obj[name]);
                    }
                    orphans.delete(name);
                });

                // remove orphans
                orphans.forEach((delname) => {
                    let childnode = this.children.get(delname);
                    childnode.remove();
                    this.children.delete(delname);
                });

                this._header.classList.add("tree-expanded");
                this._header.classList.remove("tree-collapsed");
            } else {
                this._header.classList.add("tree-collapsed");
                this._header.classList.remove("tree-expanded");
            }
        } else {
            text = typeof obj; // fallthrough
        }

        // change DOM object if needed
        if (this._inline.innerText != text) {
            this._inline.innerText = text;
        }
    }
}

export function createTreeRootNode(parent: HTMLElement, view: ProjectView): TreeNode {
    var mainnode = new TreeNode(null, null);
    mainnode.view = view;
    mainnode._content = parent;
    var root = new TreeNode(mainnode, "/");
    root.expanded = true;
    root.getDiv(); // create it
    root._div.style.padding = '0px';
    return root; // should be cached
}
