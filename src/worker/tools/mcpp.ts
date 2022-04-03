import {BuildStep, EmscriptenModule} from "../interfaces";
import {load} from "../modules";
import {emglobal, PLATFORM_PARAMS} from "../shared_vars";
import {populateFiles, setupFS} from "../files";
import {errorResult, execMain, print_fn} from "../util";
import {makeErrorMatcher} from "../errors";

export function preprocessMCPP(step: BuildStep, filesys: string) {
    load("mcpp");

    const platform = step.platform;
    const params = PLATFORM_PARAMS['zx'];

    if (!params) {
        throw Error("Platform not supported: " + platform);
    }

    // <stdin>:2: error: Can't open include file "foo.h"
    let errors = [];
    const match_fn = makeErrorMatcher(errors, /<stdin>:(\d+): (.+)/, 1, 2, step.path);
    const MCPP: EmscriptenModule = emglobal.mcpp({
        noInitialRun: true,
        noFSInit: true,
        print: print_fn,
        printErr: match_fn,
    });

    const FS = MCPP.FS;

    if (filesys) {
        setupFS(FS, filesys);
    }

    populateFiles(step, FS);

    const args = [
        "-D", "__8BITWORKSHOP__",
        "-D", "__SDCC_z80",
        "-D", makeCPPSafe(platform.toUpperCase()),
        "-I", "/share/include",
        "-Q",
        step.path, "main.i"
    ];

    if (step.mainfile) {
        args.unshift.apply(args, ["-D", "__MAIN__"]);
    }

    execMain(step, MCPP, args);

    if (errors.length) {
        return {errors};
    }

    let iout = FS.readFile("main.i", {encoding: 'utf8'});
    iout = iout.replace(/^#line /gm, '\n# ');

    try {
        const errout = FS.readFile("mcpp.err", {encoding: 'utf8'});
        if (errout.length) {

            // //main.c:2: error: Can't open include file "stdiosd.h"
            errors = extractErrors(/([^:]+):(\d+): (.+)/, errout.split("\n"), step.path, 2, 3, 1);
            if (errors.length == 0) {
                errors = errorResult(errout).errors;
            }

            return {errors};
        }
    } catch (e) {
        console.error(e);
    }

    return {code: iout};
}

function makeCPPSafe(s: string): string {
    return s.replace(/[^A-Za-z0-9_]/g, '_');
}

function extractErrors(regex, strings: string[], path: string, iline, imsg, ifilename) {
    const errors = [];
    const matcher = makeErrorMatcher(errors, regex, iline, imsg, path, ifilename);

    for (let i = 0; i < strings.length; i++) {
        matcher(strings[i]);
    }

    return errors;
}
