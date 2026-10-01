import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Decision 0073: the steps hook line burns in its clip's colour; nothing else
 * changes. The compositions are mounted with react-dom/server under a mocked
 * remotion (no browser, no bundle) and HookLine is spied, so each caller's
 * props are read directly: the hook line takes the ink, the step labels and
 * Service B's hook text do not, and HookLine's defaults are today's white on
 * TEXT_OUTLINE.
 */

vi.mock("remotion", async () => {
  const { interpolate } = await import("remotion/no-react");
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AbsoluteFill: Pass,
    Sequence: Pass,
    Freeze: Pass,
    OffthreadVideo: () => null,
    Audio: () => null,
    interpolate,
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 300 }),
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
vi.mock("../src/ServiceA", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ServiceA")>();
  return { ...actual, HookLine: vi.fn(actual.HookLine) };
});

const { HookLine } = await import("../src/ServiceA");
const { ServiceASteps } = await import("../src/ServiceASteps");
const { ServiceB } = await import("../src/ServiceB");
const { ACTIVE_WORD_COLOR, TEXT_OUTLINE } = await import("../src/overlays");
const { sampleCaptions, sampleHookText, sampleTimeline } = await import("../src/fixtures");

const spy = vi.mocked(HookLine);
const RECT = { x: 25, y: 1062, w: 1009, h: 179 };
// Written out, not derived: the composition's own replaceAll must produce it.
const LIGHT_OUTLINE =
  "5px 5px 0 rgba(255,255,255,0.92), -5px 5px 0 rgba(255,255,255,0.92), 5px -5px 0 rgba(255,255,255,0.92), -5px -5px 0 rgba(255,255,255,0.92), 0 8px 26px rgba(255,255,255,0.6)";

function hookLineCalls(markup: () => string) {
  spy.mockClear();
  const html = markup();
  return { html, calls: spy.mock.calls.map(([props]) => props) };
}

function steps(hookTextInk?: { fill: string; outline: string }) {
  return renderToStaticMarkup(
    <ServiceASteps
      hookSrc="http://127.0.0.1/hook.mp4"
      hookLine="ככה מזמינים בלי לחכות"
      hookTextSafeArea={RECT}
      hookTextInk={hookTextInk}
      demoSrc="http://127.0.0.1/demo.mp4"
      steps={[
        { startMs: 0, durationMs: 1000, label: "נכנסים לאפליקציה" },
        { startMs: 2000, durationMs: 1000, label: "בוחרים מוצר" },
      ]}
      watermark={false}
      hookDurationInFrames={90}
      demoDurationInFrames={300}
    />,
  );
}

describe("hook text ink (0073)", () => {
  it("TEXT_OUTLINE is today's outline, untouched", () => {
    expect(TEXT_OUTLINE).toBe(
      "5px 5px 0 rgba(0,0,0,0.92), -5px 5px 0 rgba(0,0,0,0.92), 5px -5px 0 rgba(0,0,0,0.92), -5px -5px 0 rgba(0,0,0,0.92), 0 8px 26px rgba(0,0,0,0.6)",
    );
  });

  it("HookLine with no ink props is white on TEXT_OUTLINE — what B, the retired path and the labels rely on", () => {
    const html = renderToStaticMarkup(<HookLine text={sampleHookText} area={RECT} />);
    expect(html).toContain("color:white");
    expect(html).toContain(`text-shadow:${TEXT_OUTLINE}`);
  });

  it("a black clip: the hook line burns black on the light outline; every step label stays yellow on TEXT_OUTLINE", () => {
    const { html, calls } = hookLineCalls(() => steps({ fill: "black", outline: "255,255,255" }));
    const [hook, ...labels] = calls;
    expect(hook).toMatchObject({ text: "ככה מזמינים בלי לחכות", color: "black" });
    expect(hook!.textShadow).toBe(LIGHT_OUTLINE);
    // Same five layers, offsets, blurs and alphas — only the rgb moved.
    expect(LIGHT_OUTLINE.replaceAll("255,255,255", "0,0,0")).toBe(TEXT_OUTLINE);
    expect(html).toContain(`color:black;text-shadow:${LIGHT_OUTLINE}`);

    expect(labels.map((props) => props.text)).toEqual(["נכנסים לאפליקציה", "בוחרים מוצר"]);
    for (const label of labels) {
      expect(label.color).toBe(ACTIVE_WORD_COLOR);
      expect(label.textShadow).toBeUndefined();
    }
  });

  it("a white clip and a render with no ink both burn today's white hook line", () => {
    for (const ink of [{ fill: "white", outline: "0,0,0" }, undefined]) {
      const { html, calls } = hookLineCalls(() => steps(ink));
      expect(calls[0]!.text).toBe("ככה מזמינים בלי לחכות");
      expect(html).toContain(`color:white;text-shadow:${TEXT_OUTLINE}`);
      expect(html).not.toContain("255,255,255");
    }
  });

  it("Service B's hook text passes no ink — it stays white on TEXT_OUTLINE", () => {
    const { html, calls } = hookLineCalls(() =>
      renderToStaticMarkup(
        <ServiceB
          talkingHeadSrc="http://127.0.0.1/head.mp4"
          voiceoverSrc="http://127.0.0.1/vo.mp3"
          brollSrcs={[]}
          captions={sampleCaptions}
          hookText={sampleHookText}
          hookTextSafeArea={RECT}
          timeline={{ ...sampleTimeline, hookTextMs: 2520 }}
          watermark={false}
        />,
      ),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe(sampleHookText);
    expect(calls[0]!.color).toBeUndefined();
    expect(calls[0]!.textShadow).toBeUndefined();
    expect(html).toContain(`color:white;text-shadow:${TEXT_OUTLINE}`);
  });
});
