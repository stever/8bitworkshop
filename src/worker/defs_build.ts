import {PlatformParams, WorkerFileUpdate, WorkerItemUpdate} from "./defs_misc";
import {BuildStepResult} from "./defs_build_result";

export interface WorkerBuildStep {
    path?: string
    files?: string[]
    tool?: string
    mainfile?: boolean
}

export interface BuildStep extends WorkerBuildStep {
    args?: string[]
    params?: PlatformParams
    result?: BuildStepResult
    prefix?: string
    maxts?: number
}

export interface WorkerMessage {
    preload?: string
    updates: WorkerFileUpdate[]
    buildsteps: WorkerBuildStep[]
    reset?: boolean
    code?: string
    setitems?: WorkerItemUpdate[]
}
