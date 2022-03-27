import {KeyDef, KeyFlags, Keys} from "./keys";

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
