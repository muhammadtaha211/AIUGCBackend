import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INP-08 control (a) — end to end with node:child_process's spawn mocked, in
 * its own file (kept separate from ffmpeg-protocol-whitelist-argv.test.ts's
 * pure argv-shape checks on the exported helper): proof that the REAL
 * wrapper functions (probe, normalizeVideo — not just the transform in
 * isolation) actually hand the whitelisted argv to spawn.
 */

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { normalizeVideo, probe } from "../src/media/ffmpeg";

type FakeProc = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

function fakeProcess(stdout: string): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout, "utf8"));
    proc.emit("close", 0);
  });
  return proc;
}

const okProbeJson = JSON.stringify({
  streams: [{ codec_type: "video", width: 10, height: 10, avg_frame_rate: "10/1" }],
  format: { duration: "1.0" },
});

beforeEach(() => {
  spawnMock.mockReset();
});

describe("ffmpeg.ts wrappers hand spawn a whitelisted argv (spawn mocked)", () => {
  it("probe() spawns ffprobe with -protocol_whitelist file prepended", async () => {
    spawnMock.mockImplementation(() => fakeProcess(okProbeJson));
    await probe("C:/work/ingest/demo-1/raw.mp4");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0]!;
    expect(bin).toBe("ffprobe");
    expect(args.slice(0, 2)).toEqual(["-protocol_whitelist", "file"]);
    expect(args.at(-1)).toBe("C:/work/ingest/demo-1/raw.mp4");
  });

  it("normalizeVideo() spawns ffmpeg with -protocol_whitelist file directly before -i", async () => {
    spawnMock.mockImplementation(() => fakeProcess(""));
    await normalizeVideo("in.mp4", "out.mp4");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0]! as [string, string[]];
    expect(bin).toBe("ffmpeg");
    const iIndex = args.indexOf("-i");
    expect(iIndex).toBeGreaterThan(0);
    expect(args[iIndex - 2]).toBe("-protocol_whitelist");
    expect(args[iIndex - 1]).toBe("file");
    expect(args[iIndex + 1]).toBe("in.mp4");
  });

  it("probe() with a formatWhitelist adds -format_whitelist alongside, not instead of, the protocol whitelist", async () => {
    spawnMock.mockImplementation(() => fakeProcess(okProbeJson));
    await probe("raw.mp4", { formatWhitelist: "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm" });

    const [, args] = spawnMock.mock.calls[0]! as [string, string[]];
    expect(args.slice(0, 2)).toEqual(["-protocol_whitelist", "file"]);
    const fwIndex = args.indexOf("-format_whitelist");
    expect(fwIndex).toBeGreaterThan(0);
    expect(args[fwIndex + 1]).toBe("mov,mp4,m4a,3gp,3g2,mj2,matroska,webm");
  });

  it("normalizeVideo() with a formatWhitelist adds -format_whitelist directly before -i, alongside the protocol whitelist (INP-08 follow-up: the raw upload is re-opened here too, not just at probe())", async () => {
    spawnMock.mockImplementation(() => fakeProcess(""));
    await normalizeVideo("in.mp4", "out.mp4", {
      formatWhitelist: "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm",
    });

    const [bin, args] = spawnMock.mock.calls[0]! as [string, string[]];
    expect(bin).toBe("ffmpeg");
    const iIndex = args.indexOf("-i");
    expect(args[iIndex - 2]).toBe("-protocol_whitelist");
    expect(args[iIndex - 1]).toBe("file");
    const fwIndex = args.indexOf("-format_whitelist");
    expect(fwIndex).toBeGreaterThan(0);
    expect(fwIndex).toBeLessThan(iIndex); // both are per-input AVOptions — must precede -i
    expect(args[fwIndex + 1]).toBe("mov,mp4,m4a,3gp,3g2,mj2,matroska,webm");
  });
});
