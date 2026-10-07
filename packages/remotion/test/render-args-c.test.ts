import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { RenderPropsError, renderServiceC } from "../src/render";

/**
 * renderServiceC's encode arguments, mocked like render-args.test.ts: the
 * steps format passes muted:true to drop its stream; Service C must pass
 * NEITHER muted nor enforceAudioTrack, so the clip's own sound reaches the
 * mp4 through the default aac encode (decision 0090 §5).
 */

type RenderMediaArgs = {
  muted?: unknown;
  enforceAudioTrack?: unknown;
  audioCodec?: unknown;
  codec?: unknown;
};
type SelectArgs = { id: string; inputProps: Record<string, unknown> };

const renderMedia = vi.fn(async (_options: RenderMediaArgs) => undefined);
const selectComposition = vi.fn(async (args: SelectArgs) => ({ id: args.id, durationInFrames: 1 }));
vi.mock("@remotion/bundler", () => ({ bundle: async () => "http://bundle" }));
vi.mock("@remotion/renderer", () => ({
  selectComposition: (args: SelectArgs) => selectComposition(args),
  renderMedia: (options: RenderMediaArgs) => renderMedia(options),
}));

const dir = mkdtempSync(path.join(tmpdir(), "aiugc-render-args-c-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const RECT = { x: 80, y: 360, w: 820, h: 1040 };

function input(text = "עשרים הודעות ב-8 בערב? יש Sederly.") {
  writeFileSync(path.join(dir, "clip.mp4"), "stub");
  return { clipPath: path.join(dir, "clip.mp4"), text, textSafeArea: RECT, watermark: false };
}

describe("renderServiceC", () => {
  it("selects the ServiceC composition with the served clip and keeps the clip's audio", async () => {
    renderMedia.mockClear();
    selectComposition.mockClear();
    await renderServiceC(
      { ...input(), textInk: { fill: "black", outline: "255,255,255" } },
      path.join(dir, "out.mp4"),
    );

    const select = selectComposition.mock.calls.at(-1)![0];
    expect(select.id).toBe("ServiceC");
    expect(select.inputProps.clipSrc).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(select.inputProps).toMatchObject({
      text: "עשרים הודעות ב-8 בערב? יש Sederly.",
      textSafeArea: RECT,
      textInk: { fill: "black", outline: "255,255,255" },
      watermark: false,
    });

    const args = renderMedia.mock.calls.at(-1)![0];
    expect(args.codec).toBe("h264");
    expect(args.audioCodec).toBe("aac");
    expect(args.muted).toBeUndefined();
    expect(args.enforceAudioTrack).toBeUndefined();
  });

  it("refuses an empty text and a missing clip as permanent", async () => {
    await expect(renderServiceC(input(""), path.join(dir, "out.mp4"))).rejects.toThrow(
      RenderPropsError,
    );
    await expect(
      renderServiceC(
        { ...input(), clipPath: path.join(dir, "missing.mp4") },
        path.join(dir, "o.mp4"),
      ),
    ).rejects.toThrow(RenderPropsError);
  });
});
