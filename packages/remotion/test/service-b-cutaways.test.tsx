import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Demo cutaways (vault 0121) and the sway's removal (0120 §2), read off the
 * composition's markup: remotion is mocked so every Sequence and video says
 * where it sits, what it plays and whether it is muted — no browser, no bundle.
 */

let frame = 0;
vi.mock("remotion", async () => {
  const { interpolate } = await import("remotion/no-react");
  return {
    AbsoluteFill: ({ children, style }: { children?: ReactNode; style?: object }) => (
      <div data-fill={JSON.stringify(style ?? {})}>{children}</div>
    ),
    Sequence: ({
      children,
      from,
      durationInFrames,
    }: {
      children?: ReactNode;
      from?: number;
      durationInFrames?: number;
    }) => (
      <section data-from={from ?? 0} data-duration={durationInFrames ?? "inf"}>
        {children}
      </section>
    ),
    Freeze: ({ children }: { children?: ReactNode }) => <>{children}</>,
    OffthreadVideo: ({
      src,
      muted,
      trimBefore,
    }: {
      src: string;
      muted?: boolean;
      trimBefore?: number;
    }) => <video data-src={src} data-muted={String(Boolean(muted))} data-trim={trimBefore ?? 0} />,
    Audio: ({ src }: { src: string }) => <audio data-src={src} />,
    interpolate,
    useCurrentFrame: () => frame,
    useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 600 }),
  };
});
vi.mock("@remotion/media-utils", () => ({
  getVideoMetadata: vi.fn(),
  getAudioDurationInSeconds: vi.fn(),
}));
vi.mock("@remotion/layout-utils", () => ({
  measureText: ({ text, fontSize }: { text: string; fontSize: number }) => ({
    width: text.length * fontSize * 0.5,
    height: fontSize,
  }),
}));
vi.mock("@remotion/google-fonts/Heebo", () => ({ loadFont: () => ({ fontFamily: "Heebo" }) }));

const { ServiceB } = await import("../src/ServiceB");
const { voBoundaryFrame } = await import("../src/timing");
const { sampleCaptions, sampleHookText, sampleTimeline } = await import("../src/fixtures");

const RECT = { x: 25, y: 1062, w: 1009, h: 179 };
const DEMO = "http://127.0.0.1/demo.mp4";
const timeline = { ...sampleTimeline, hookTextMs: 2520, totalMs: 20_000 };
const slots = [
  { fromMs: 4080, toMs: 9440, demoStartMs: 12_000 },
  { fromMs: 10_960, toMs: 15_080, demoStartMs: 30_000 },
];

function markup(props: Partial<Parameters<typeof ServiceB>[0]> = {}, atFrame = 0) {
  frame = atFrame;
  return renderToStaticMarkup(
    <ServiceB
      talkingHeadSrc="http://127.0.0.1/head.mp4"
      voiceoverSrc="http://127.0.0.1/vo.mp3"
      captions={sampleCaptions}
      hookText={sampleHookText}
      hookTextSafeArea={RECT}
      timeline={timeline}
      watermark={false}
      {...props}
    />,
  );
}

describe("ServiceB without the sway", () => {
  it("the picture holds a static 1.06 scale on every frame — the outer container moves nothing", () => {
    for (const at of [0, 37, 300]) {
      const html = markup({}, at);
      // The container the sway used to drive: its whole transform is the scale.
      expect(html).toContain('data-fill="{&quot;transform&quot;:&quot;scale(1.06)&quot;}"');
      expect(html).not.toContain("rotate(");
    }
  });
});

describe("ServiceB demo cutaways", () => {
  it("mounts each window muted, on the captions' boundary frames, playing its stretch of the demo", () => {
    const html = markup({ cutaways: { src: DEMO, slots } });
    const demos = [
      ...html.matchAll(
        /<section data-from="(\d+)" data-duration="(\d+)"><div[^>]*><video data-src="([^"]+)" data-muted="(\w+)" data-trim="(\d+)"/g,
      ),
    ]
      .filter((m) => m[3] === DEMO)
      .map((m) => ({
        from: Number(m[1]),
        duration: Number(m[2]),
        muted: m[4],
        trim: Number(m[5]),
      }));
    const off = timeline.captionOffsetMs;
    expect(demos).toEqual([
      {
        from: voBoundaryFrame(4080, off),
        duration: voBoundaryFrame(9440, off) - voBoundaryFrame(4080, off),
        muted: "true",
        trim: 360,
      },
      {
        from: voBoundaryFrame(10_960, off),
        duration: voBoundaryFrame(15_080, off) - voBoundaryFrame(10_960, off),
        muted: "true",
        trim: 900,
      },
    ]);
  });

  it("keeps the head, the voice and the overlays: the demo sits outside the scaled picture and under the text", () => {
    const html = markup({ cutaways: { src: DEMO, slots } });
    // The head is still mounted, from the start, under the static scale.
    expect(html).toContain('data-src="http://127.0.0.1/head.mp4"');
    // One audio track: the approved voiceover.
    expect([...html.matchAll(/<audio /g)]).toHaveLength(1);
    const scaled = html.indexOf("scale(1.06)");
    const head = html.indexOf("head.mp4");
    const firstDemo = html.indexOf(DEMO);
    const hookText = html.indexOf(sampleHookText.split(" ")[0]!);
    expect(scaled).toBeLessThan(head);
    expect(head).toBeLessThan(firstDemo);
    expect(firstDemo).toBeLessThan(hookText);
    // The demo is not inside the scaled container: between the scale and the
    // demo, every div that opens has closed — the scaled one included — except
    // the cutaway's own fill, which opened just before its video.
    const between = html.slice(scaled, firstDemo);
    const opened = between.split("<div").length - 1;
    const closed = between.split("</div>").length - 1;
    expect(opened).toBe(closed);
  });

  it("a head-only render mounts no demo at all", () => {
    expect(markup()).not.toContain(DEMO);
  });
});
