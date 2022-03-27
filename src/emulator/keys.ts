type KeyboardCallback = (which: number, charCode: number, flags: KeyFlags) => void;

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
