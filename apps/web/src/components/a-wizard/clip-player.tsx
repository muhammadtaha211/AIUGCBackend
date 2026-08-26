"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/ui/icons";
import { apiFetch } from "@/lib/use-api";

/**
 * One shared <video> for every clip preview on the plan step. A "clip" is a
 * seek window into the demo's single normalized file (there are no per-clip
 * assets), so one element and one lazily-fetched signed URL serve the step
 * cards and the inventory tiles alike. One element is deliberate: mobile
 * browsers cap concurrent media decoders and throttle pages holding many
 * media elements, and at most one preview should play at a time anyway —
 * playing clip B is what stops clip A. Muted always: hover-triggered
 * autoplay is only allowed muted, and the steps format renders silent
 * regardless, so a muted preview is the honest one.
 */

export type ClipTarget = { key: string; startMs: number; endMs: number };

export type ClipPlayer = {
  /** The one clip currently playing (or waiting for its URL). */
  active: ClipTarget | null;
  videoUrl: string | null;
  play: (target: ClipTarget) => void;
  stop: () => void;
  /** <video> error path: one signed-URL refetch (expiry), then quiet idle. */
  onVideoError: () => void;
};

export function useClipPlayer(demoId: string): ClipPlayer {
  const [active, setActive] = useState<ClipTarget | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fetching = useRef(false);
  const refetched = useRef(false);

  async function fetchUrl(): Promise<void> {
    if (fetching.current) return;
    fetching.current = true;
    const result = await apiFetch<{ videoUrl: string }>(`/api/demos/${demoId}/video`);
    fetching.current = false;
    if (result.ok) setVideoUrl(result.body.videoUrl);
    // Quiet fallback on failure: previews are a nicety — the thumbs stay,
    // nothing else on the step depends on this.
    else setActive(null);
  }

  return {
    active,
    videoUrl,
    play(target) {
      setActive(target);
      if (!videoUrl) void fetchUrl();
    },
    stop: () => setActive(null),
    onVideoError() {
      if (refetched.current) return setActive(null);
      refetched.current = true;
      setVideoUrl(null);
      void fetchUrl();
    },
  };
}

/**
 * The video element itself. The HOST decides where it mounts: render it
 * inside the active thumb's relatively-positioned container, gated on
 * `player.active?.key === <my key>` — React's conditional mounting is what
 * guarantees at most one <video> in the DOM. Keyed by clip so switching
 * targets remounts and refires loadedmetadata (the seek-and-play hook);
 * the browser's HTTP cache absorbs the remount.
 *
 * Exits back to idle (the play icon reappearing, never a loop): timeupdate
 * crossing endMs (~250ms granularity — invisible overshoot on a 3s
 * preview), the file's own `ended`, or an error after its one URL retry.
 */
export function ClipVideo({ player }: { player: ClipPlayer }) {
  const target = player.active;
  if (!target) return null;
  if (!player.videoUrl) {
    return (
      <span className="absolute inset-0 flex items-center justify-center bg-ink/40">
        <Spinner className="size-5 text-white" />
      </span>
    );
  }
  return (
    <video
      key={target.key}
      src={player.videoUrl}
      muted
      playsInline
      preload="metadata"
      className="absolute inset-0 size-full object-cover"
      onLoadedMetadata={(event) => {
        const el = event.currentTarget;
        el.currentTime = target.startMs / 1000;
        void el.play().catch(() => player.stop());
      }}
      onTimeUpdate={(event) => {
        if (event.currentTarget.currentTime * 1000 >= target.endMs) player.stop();
      }}
      onEnded={() => player.stop()}
      onError={() => player.onVideoError()}
    />
  );
}
