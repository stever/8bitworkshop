export interface SavesState<S> {
    saveState(): S;

    loadState(state: S): void;
}

export interface Bus {
    read(a: number): number;

    write(a: number, v: number): void;

    readConst?(a: number): number;
}

export type TrapCondition = () => boolean;

export interface SampledAudioSink {
    feedSample(value: number, count: number): void;
}

export interface Resettable {
    reset(): void;
}

export interface MemoryBusConnected {
    connectMemoryBus(bus: Bus): void;
}

export interface CPU extends MemoryBusConnected, Resettable, SavesState<any> {
    getPC(): number;

    getSP(): number;

    isStable(): boolean;
}

// SERIAL I/O

export interface SerialEvent {
    op: 'read' | 'write';
    value: number;
    nbits: number;
}

export interface SerialIOInterface {
    
    // from machine to platform
    clearToSend(): boolean;

    sendByte(b: number);

    // from platform to machine
    byteAvailable(): boolean;

    recvByte(): number;

    // implement these too
    reset(): void;

    advance(clocks: number): void;
}

export interface HasSerialIO {
    connectSerialIO(serial: SerialIOInterface);

    serialOut?: SerialEvent[];    // outgoing event log
    serialIn?: SerialEvent[];     // incoming queue
}

/// PROFILER

export interface Probeable {
    connectProbe(probe: ProbeAll): void;
}

export interface ProbeTime {
    logClocks(clocks: number);

    logNewScanline();

    logNewFrame();
}

export interface ProbeCPU {
    logExecute(address: number, SP: number);

    logInterrupt(type: number);

    logIllegal(address: number);
}

export interface ProbeBus {
    logRead(address: number, value: number);

    logWrite(address: number, value: number);
}

export interface ProbeIO {
    logIORead(address: number, value: number);

    logIOWrite(address: number, value: number);
}

export interface ProbeVRAM {
    logVRAMRead(address: number, value: number);

    logVRAMWrite(address: number, value: number);
}

export interface ProbeAll extends ProbeTime, ProbeCPU, ProbeBus, ProbeIO, ProbeVRAM {
    logData(data: number); // entire 32 bits
    addLogBuffer(src: Uint32Array);
}

export class NullProbe implements ProbeAll {
    logClocks() {}

    logNewScanline() {}

    logNewFrame() {}

    logExecute() {}

    logInterrupt() {}

    logRead() {}

    logWrite() {}

    logIORead() {}

    logIOWrite() {}

    logVRAMRead() {}

    logVRAMWrite() {}

    logIllegal() {}

    logData() {}

    addLogBuffer(src: Uint32Array) {}
}
