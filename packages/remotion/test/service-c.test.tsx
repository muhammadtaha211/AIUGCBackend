import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Service C (decision 0090): the clip is mounted UNMUTED — its own sound is
 * the track — and the text block burns in the typed-in-the-app look: weight
 * 500, the paragraph fitter's size, a thin edge plus a soft shadow in the
 * ink's rgb, pre-wrap for the quiz's line breaks, one isolated span. Mounted
 * with react-dom/server under a mocked remotion (no browser, no bundle), the
 * 0073 test's pattern, with OffthreadVideo spied so its props are read.
 */

const offthreadVideo = vi.hoisted(() => vi.fn(() => null));

vi.mock("remotion", async () => {
  const { interpolate } = await import("remotion/no-react");
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AbsoluteFill: Pass,
    Sequence: Pass,
    Freeze: Pass,
    OffthreadVideo: offthreadVideo,
    Audio: () => null,
    interpolate,
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 300 }),
  };
});
vi.mock("@remotion/media-utils", () => ({
  getVideoMetadata: vi.fn(async () => ({ durationInSeconds: 10.02 })),
  getAudioDurationInSeconds: vi.fn(),
}));
vi.mock("@remotion/layout-utils", () => ({
  measureText: ({ text, fontSize }: { text: string; fontSize: number }) => ({
    width: text.length * fontSize * 0.5,
    height: fontSize,
  }),
}));
vi.mock("@remotion/google-fonts/Heebo", () => ({ loadFont: () => ({ fontFamily: "Heebo" }) }));

const { ServiceC, TextBlock, calculateServiceCMetadata, textBlockShadow } =
  await import("../src/ServiceC");
const { sampleTextBlock, sampleTextBlockQuiz } = await import("../src/fixtures");

const RECT = { x: 80, y: 360, w: 820, h: 1040 };
const DARK = "0 0 2px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9), 0 2px 12px rgba(0,0,0,0.5)";

describe("ServiceC composition", () => {
  it("mounts the clip without muted — the clip's own sound is the audio track", () => {
    offthreadVideo.mockClear();
    renderToStaticMarkup(
      <ServiceC
        clipSrc="http://127.0.0.1/clip.mp4"
        text={sampleTextBlock}
        textSafeArea={RECT}
        watermark={false}
      />,
    );
    expect(offthreadVideo).toHaveBeenCalledTimes(1);
    const props = offthreadVideo.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.src).toBe("http://127.0.0.1/clip.mp4");
    expect(props.muted).toBeUndefined();
    expect(props.trimBefore).toBeUndefined();
  });

  it("burns the block in the typed look: weight 500, white on the dark edge, pre-wrap, one isolated span", () => {
    const html = renderToStaticMarkup(<TextBlock text={sampleTextBlockQuiz} area={RECT} />);
    expect(html).toContain("font-weight:500");
    expect(html).toContain("color:white");
    expect(html).toContain(`text-shadow:${DARK}`);
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("direction:rtl");
    expect(html).toContain("left:80px;top:360px;width:820px;height:1040px");
    // The newlines reach the markup as newlines, inside the one span.
    expect(html.match(/unicode-bidi:isolate/g)).toHaveLength(1);
    expect(html).toContain("1. איזו עיר בארץ הכי גבוהה מעל פני הים?\n2. מי היה");
    expect(textBlockShadow("0,0,0")).toBe(DARK);
  });

  it("a black clip burns black on a light edge, from the ink the render passes", () => {
    const html = renderToStaticMarkup(
      <ServiceC
        clipSrc="http://127.0.0.1/clip.mp4"
        text={sampleTextBlock}
        textSafeArea={RECT}
        textInk={{ fill: "black", outline: "255,255,255" }}
        watermark={false}
      />,
    );
    expect(html).toContain("color:black");
    expect(html).toContain(`text-shadow:${DARK.replaceAll("0,0,0", "255,255,255")}`);
    expect(html).not.toContain("rgba(0,0,0");
  });

  it("the composition is exactly the clip, once: calculateMetadata probes it for the frame count", async () => {
    const result = await calculateServiceCMetadata({
      props: {
        clipSrc: "http://127.0.0.1/clip.mp4",
        text: sampleTextBlock,
        textSafeArea: RECT,
        watermark: false,
      },
      defaultProps: {} as never,
      abortSignal: new AbortController().signal,
      compositionId: "ServiceC",
      isRendering: true,
    });
    expect(result).toMatchObject({ durationInFrames: 301, props: { clipDurationInFrames: 301 } });
  });
});
