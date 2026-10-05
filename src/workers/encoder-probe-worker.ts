import { probeEncoder } from "../transcode/encoder-probe.js";
import { createWorkerServer, type WorkerScopeEndpoint } from "./_protocol/worker-server.js";

declare const self: WorkerScopeEndpoint;

createWorkerServer(self, {
    onRequest: (type, data, ctx) => {
        if (type !== "probe" || typeof data !== "object" || data === null)
            throw new Error("invalid encoder probe request");
        const config = data as Record<string, unknown>;
        const { width, height, frameRate, bitrate } = config;
        if (
            typeof width !== "number" ||
            typeof height !== "number" ||
            typeof frameRate !== "number" ||
            typeof bitrate !== "number" ||
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 2 ||
            height < 2 ||
            width % 2 ||
            height % 2 ||
            !Number.isFinite(frameRate) ||
            frameRate < 5 ||
            frameRate > 120 ||
            !Number.isFinite(bitrate) ||
            bitrate <= 0
        )
            throw new Error("invalid encoder probe configuration");
        return probeEncoder({ width, height, frameRate, bitrate }, ctx.signal);
    },
});
