import {CodeListingMap} from "./types";
import {
    anyTargetChanged,
    BuildStep,
    BuildStepResult,
    emglobal,
    EmscriptenModule,
    execMain,
    gatherFiles,
    loadNative,
    makeErrorMatcher,
    moduleInstFn,
    parseListing,
    populateFiles,
    print_fn,
    putWorkFile,
    staleFiles
} from "./main"

export function assembleZMAC(step: BuildStep): BuildStepResult {
    loadNative("zmac");

    var lstout, binout;
    var errors = [];

    gatherFiles(step, {mainFilePath: "main.asm"});

    var lstpath = step.prefix + ".lst";
    var binpath = step.prefix + ".cim";

    if (staleFiles(step, [binpath, lstpath])) {
        var ZMAC: EmscriptenModule = emglobal.zmac({
            instantiateWasm: moduleInstFn('zmac'),
            noInitialRun: true,
            //logReadFiles:true,
            print: print_fn,
            printErr: makeErrorMatcher(errors, /([^( ]+)\s*[(](\d+)[)]\s*:\s*(.+)/, 2, 3, step.path),
        });

        var FS = ZMAC.FS;
        populateFiles(step, FS);
        execMain(step, ZMAC, ['-z', '-c', '--oo', 'lst,cim', step.path]);

        if (errors.length) {
            return {errors: errors};
        }

        lstout = FS.readFile("zout/" + lstpath, {encoding: 'utf8'});
        binout = FS.readFile("zout/" + binpath, {encoding: 'binary'});

        putWorkFile(binpath, binout);
        putWorkFile(lstpath, lstout);

        if (!anyTargetChanged(step, [binpath, lstpath])) {
            return;
        }

        //  230: 1739+7+x   017A  1600      L017A: LD      D,00h
        var lines = parseListing(lstout, /\s*(\d+):\s*([0-9a-f]+)\s+([0-9a-f]+)\s+(.+)/i, 1, 2, 3);
        var listings: CodeListingMap = {};
        listings[lstpath] = {lines: lines};

        // parse symbol table
        var symbolmap = {};
        var sympos = lstout.indexOf('Symbol Table:');
        if (sympos > 0) {
            var symout = lstout.slice(sympos + 14);
            symout.split('\n').forEach(function (l) {
                var m = l.match(/(\S+)\s+([= ]*)([0-9a-f]+)/i);
                if (m) {
                    symbolmap[m[1]] = parseInt(m[3], 16);
                }
            });
        }

        return {
            output: binout,
            listings: listings,
            errors: errors,
            symbolmap: symbolmap
        };
    }
}
