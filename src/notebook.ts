import { Component, h, createRef, VNode } from 'preact';
import { PROP_CONSTRUCTOR_NAME } from "./env";
import { hex, isArray } from "./util";
import { dumpRAM } from "./emu";
import { current_project } from "./ui";

import * as scriptui from "./scriptui";

const MAX_STRING_LEN = 100;

function sendInteraction(iobj: scriptui.Interactive, type: string, event: Event, xtraprops: {}) {
    let irec = iobj.$$interact;
    let ievent : scriptui.InteractEvent = {interactid: irec.interactid, type, ...xtraprops};

    if (event instanceof PointerEvent) {
        const canvas = event.target as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        ievent.x = Math.floor(x);
        ievent.y = Math.floor(y);
    } else {
        console.log("Unknown event type", event);
    }

    current_project.updateDataItems([{
        key: scriptui.EVENT_KEY,
        value: ievent
    }]);
}

interface ObjectTreeComponentProps {
    name?: string;
    object: {} | [];
    objpath: string;
}

interface ObjectTreeComponentState {
    expanded: boolean;
}

class ObjectKeyValueComponent extends Component<ObjectTreeComponentProps, ObjectTreeComponentState> {
    render(virtualDom, containerNode, replaceNode) {
        let expandable = typeof this.props.object === 'object';
        let hdrclass = '';
        if (expandable) hdrclass = this.state.expanded ? 'tree-expanded' : 'tree-collapsed'
        let propName = this.props.name || null;
        return h('div', {
            class: 'tree-content',
            key: `${this.props.objpath}__tree`
        }, [
            h('div', {
                class: 'tree-header ' + hdrclass,
                onClick: expandable ? () => this.toggleExpand() : null
            }, [
                propName != null ? h('span', { class: 'tree-key' }, [ propName, expandable ]) : null,
                h('span', { class: 'tree-value scripting-item' }, [
                    getShortName(this.props.object)
                ])
            ]),
            this.state.expanded ? objectToContentsDiv(this.props.object, this.props.objpath) : null
        ]);
    }

    toggleExpand() {
        this.setState({ expanded: !this.state.expanded });
    }
}

function getShortName(object: any) {
    if (typeof object === 'object') {
        try {
            var s = object[PROP_CONSTRUCTOR_NAME] || Object.getPrototypeOf(object).constructor.name;
            if (object.length > 0) {
                s += `[${object.length}]`
            }
            return s;
        } catch (e) {
            console.log(e);
            return e + "";
        }
    } else {
        return primitiveToString(object);
    }
}

function primitiveToString(obj) {
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
    } else if (typeof obj == 'string') {
        text = obj;
    } else {
        text = JSON.stringify(obj);
    }
    if (text.length > MAX_STRING_LEN)
        text = text.substring(0, MAX_STRING_LEN) + "...";
    return text;
}

function objectToChildren(object: any) : any[] {
    if (isArray(object)) {
        return Array.from(object);
    } else if (object != null) {
        return [ object ]
    } else {
        return [ ]
    }
}

function objectToChild(object: any, index: number) : any {
    if (isArray(object)) {
        return object[index];
    } else if (object != null) {
        return object
    } else {
        return null
    }
}

function objectToDiv(object: any, name: string, objpath: string): VNode<any> {
    // don't view any keys that start with "$"
    if (name && name.startsWith("$")) {
        // don't view any values that start with "$$"
        if (name.startsWith("$$")) return;
        // don't print if null or undefined
        if (object == null) return;
        // don't print key in any case
        name = null;
    }

    if (object == null) {
        return h('span', { }, object + "");
    } else if (object['uitype']) {
        let cons = UI_COMPONENTS[object['uitype']];
        if (!cons) throw new Error(`Unknown UI component type: ${object['uitype']}`);
        return h(cons, { iokey: objpath, uiobject: object });
    } else if (object['literaltext']) {
        return h("pre", { }, [ object['literaltext'] ]);
    } else {
        return h(ObjectKeyValueComponent, { name, object, objpath }, []);
    }
}

function fixedArrayToDiv(tyarr: Array<number>, bpel: number, objpath: string) {
    const maxBytes = 0x100;
    if (tyarr.length <= maxBytes) {
        let dumptext = dumpRAM(tyarr, 0, tyarr.length);
        return h('pre', {}, dumptext);
    } else {
        let children = [];
        for (var ofs = 0; ofs < tyarr.length; ofs += maxBytes) {
            children.push(objectToDiv(tyarr.slice(ofs, ofs + maxBytes), '$' + hex(ofs), `${objpath}.${ofs}`));
        }
        return h('div', {}, children);
    }
}

function objectToContentsDiv(object: {} | [], objpath: string) {
    // is typed array?
    let bpel = object['BYTES_PER_ELEMENT'];
    if (typeof bpel === 'number') {
        return fixedArrayToDiv(object as Array<number>, bpel, objpath);
    }
    let objectEntries = Object.entries(object);
    let objectDivs = objectEntries.map(entry => objectToDiv(entry[1], entry[0], `${objpath}.${entry[1]}`));
    return h('div', { class: 'scripting-flex' }, objectDivs);
}

interface UIComponentProps {
    iokey: string;
    uiobject: scriptui.ScriptUIType;
    dropdown?: boolean;
}

class UISliderComponent extends Component<UIComponentProps> {
    render(virtualDom, containerNode, replaceNode) {
        let slider = this.props.uiobject as scriptui.ScriptUISliderType;
        return h('div', {}, [
            this.props.iokey,
            h('input', {
                type: 'range',
                min: slider.min / slider.step,
                max: slider.max / slider.step,
                value: slider.value / slider.step,
                onInput: (ev) => {
                    let newUIValue = { value: parseFloat(ev.target.value) * slider.step };
                    this.setState(this.state);
                    current_project.updateDataItems([{key: this.props.iokey, value: newUIValue}]);
                }
            }),
            h('span', { }, getShortName(slider.value)),
        ]);
    }
}

class UISelectComponent extends Component<UIComponentProps, ObjectTreeComponentState> {
    ref = createRef();
    render(virtualDom, containerNode, replaceNode) {
        let select = this.props.uiobject as scriptui.ScriptUISelectType<any>;
        let children = objectToChildren(select.options);
        this.props.dropdown = children.length > 16;
        let showselections = !this.props.dropdown || this.state.expanded;
        let seldiv = null;

        if (showselections) {
            seldiv = h('div', {
                class: 'scripting-select scripting-flex',
                ref: this.ref,
                onClick: (e) => {
                    // select object -- iterate parents until we find select div, then find index of child
                    let target = e.target as HTMLElement;
                    while (target.parentElement && target.parentElement != this.ref.current) {
                        target = target.parentElement;
                    }
                    if (target.parentElement) {
                        const selindex = Array.from(target.parentElement.children).indexOf(target);
                        if (selindex >= 0 && selindex < children.length) {
                            let newUIValue = { value: children[selindex], index: selindex };
                            this.setState({ expanded: false });
                            current_project.updateDataItems([{key: this.props.iokey, value: newUIValue}]);
                        } else {
                            throw new Error(`Could not find click target of ${this.props.iokey}`);
                        }
                    }
                }
            },
            children.map((child, index) => {
                let div = objectToDiv(child, null, `${this.props.iokey}__select_${index}`);
                let selected = (index == select.index);
                return h('div', { class: selected ? 'scripting-selected' : '' }, [ div ]);
            }));
        }

        if (this.props.dropdown) {
            let selectedDiv = objectToDiv(objectToChild(select.options, select.index), null, `${this.props.iokey}__selected`);
            return h('div', {
                class: 'tree-content',
                key: `${this.props.iokey}__tree`
            }, [
                h('div', {
                    class: 'tree-header ' + (this.state.expanded ? 'tree-expanded' : 'tree-collapsed'),
                    onClick: () => this.toggleExpand()
                }, [
                    this.props.iokey,
                    h('span', { class: 'tree-value scripting-item' }, [
                        selectedDiv,
                        //getShortName(select.options)
                    ])
                ]),
                seldiv
            ]);
        } else {
            return seldiv;
        }
    }

    toggleExpand() {
        this.setState({ expanded: !this.state.expanded });
    }
}

class UIButtonComponent extends Component<UIComponentProps> {
    render(virtualDom, containerNode, replaceNode) {
        let button = this.props.uiobject as scriptui.ScriptUIButtonType;
        return h('button', {
            class: button.enabled ? 'scripting-button scripting-enabled' : 'scripting-button',
            onClick: (e: MouseEvent) => {
                sendInteraction(button, 'click', e, { });
            },
        }, [
            button.label
        ])
    }
}

class UIShortcutComponent extends Component<UIComponentProps> {
    render(virtualDom, containerNode, replaceNode) {
        let shortcut = this.props.uiobject as scriptui.ScriptUIShortcut;
        return h('div', {
            onKeyDown: (e: KeyboardEvent) => {
                sendInteraction(shortcut, 'key', e, { });
            },
        }, [ ])
    }
}

const UI_COMPONENTS = {
    'slider': UISliderComponent,
    'select': UISelectComponent,
    'button': UIButtonComponent,
    'shortcut': UIShortcutComponent,
}
