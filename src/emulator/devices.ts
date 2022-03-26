export interface SavesState<S> {
    saveState(): S;

    loadState(state: S): void;
}

export interface Bus {
    read(a: number): number;

    write(a: number, v: number): void;

    readConst?(a: number): number;
}

export interface InstructionBased {
    advanceInsn(): number;
}

export type TrapCondition = () => boolean;

export interface FrameBased {
    advanceFrame(trap: TrapCondition): number;
}

export interface VideoSource {
    getVideoParams(): VideoParams;

    connectVideo(pixels: Uint32Array): void;
}

export interface RasterFrameBased extends FrameBased, VideoSource {
    getRasterY(): number;

    getRasterX(): number;
}

export interface VideoParams {
    width: number;
    height: number;
    overscan?: boolean;
    rotate?: number;
    videoFrequency?: number; // default = 60
    aspect?: number;
}

export interface SampledAudioParams {
    sampleRate: number;
    stereo: boolean;
}

export interface SampledAudioSink {
    feedSample(value: number, count: number): void;
}

export interface SampledAudioSource {
    getAudioParams(): SampledAudioParams;

    connectAudio(audio: SampledAudioSink): void;
}

export interface AcceptsROM {
    loadROM(data: Uint8Array, title?: string): void;
}

export interface AcceptsBIOS {
    loadBIOS(data: Uint8Array, title?: string): void;
}

export interface Resettable {
    reset(): void;
}

export interface MemoryBusConnected {
    connectMemoryBus(bus: Bus): void;
}

export interface IOBusConnected {
    connectIOBus(bus: Bus): void;
}

export interface CPU extends MemoryBusConnected, Resettable, SavesState<any> {
    getPC(): number;

    getSP(): number;

    isStable(): boolean;
}

export interface HasCPU extends Resettable {
    cpu: CPU;
}

export interface Interruptable<IT> {
    interrupt(type: IT): void;
}

export interface SavesInputState<CS> {
    loadControlsState(cs: CS): void;

    saveControlsState(): CS;
}

export interface AcceptsKeyInput {
    setKeyInput(key: number, code: number, flags: number): void;
}

export interface AcceptsPaddleInput {
    setPaddleInput(controller: number, value: number): void;
}

export interface AcceptsJoyInput {
    setJoyInput(joy: number, bitmask: number): void;
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
