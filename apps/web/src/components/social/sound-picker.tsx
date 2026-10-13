"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Spinner, Stop } from "@/components/ui/icons";
import { isInstagramPage, type SoundChoice } from "@/lib/schedule-form";
import {
  chosenSoundLine,
  mixLine,
  NO_SOUND,
  SOUND_GROUP_MUSIC,
  SOUND_GROUP_REELS,
  SOUND_LABEL,
  SOUND_MORE,
  SOUND_NO_PREVIEW,
  SOUND_NONE_FOUND,
  SOUND_NOTE,
  SOUND_NOTE_DOWNLOAD,
  SOUND_ON_INSTAGRAM,
  SOUND_PREVIEW_ARIA,
  SOUND_RECONNECT,
  SOUND_SEARCH_FAILED,
  SOUND_SEARCH_PLACEHOLDER,
  SOUND_TAB_SEARCH,
  SOUND_TAB_TRENDING,
} from "@/lib/social-posting-ui";
import { apiFetch } from "@/lib/use-api";

type Kind = "original_sound" | "music";
type Group = { items: SoundChoice[]; after?: string; loadingMore: boolean };
type SearchResponse =
  { status: "ok"; items: SoundChoice[]; after?: string } | { status: "reconnect" };

const KINDS: { kind: Kind; title: string }[] = [
  { kind: "original_sound", title: SOUND_GROUP_REELS },
  { kind: "music", title: SOUND_GROUP_MUSIC },
];

function soundsUrl(accountId: string, kind: Kind, query: string, after?: string): string {
  const params = new URLSearchParams({ accountId, kind });
  if (query) params.set("q", query);
  if (after) params.set("after", after);
  return `/api/social/instagram/sounds?${params.toString()}`;
}

function duration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The sound picker (decision 0101 §2 and §9): Meta's catalogue through our own
 * proxy, trending while the search is empty, two groups — sounds from Reels
 * and music — each with its own "עוד תוצאות" while Meta pages. Under the list,
 * the note with its download button: the catalogue Meta authorises for apps
 * is narrower than the app's own (its Audio API page says so), and the answer
 * is the video itself. One choice covers every Instagram account of the post.
 */
export function SoundPicker({
  accountId,
  value,
  onChange,
  downloadUrl,
  service,
  voiced,
}: {
  /** An Instagram account whose sound token is good, or null — then the reconnect line. */
  accountId: string | null;
  value: SoundChoice | null;
  onChange: (sound: SoundChoice | null) => void;
  downloadUrl?: string;
  service: "a" | "b" | "c";
  voiced: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [groups, setGroups] = useState<Record<Kind, Group> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "reconnect" | "error">(
    accountId ? "loading" : "reconnect",
  );
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!accountId) {
      setState("reconnect");
      return;
    }
    const run = ++sequence.current;
    setState("loading");
    void Promise.all(
      KINDS.map(({ kind }) => apiFetch<SearchResponse>(soundsUrl(accountId, kind, debounced))),
    ).then((results) => {
      if (run !== sequence.current) return; // a newer query answered first
      if (results.some((r) => r.ok && r.body.status === "reconnect")) {
        setState("reconnect");
        return;
      }
      if (results.some((r) => !r.ok)) {
        setState("error");
        return;
      }
      const next = {} as Record<Kind, Group>;
      KINDS.forEach(({ kind }, i) => {
        const r = results[i]!;
        const body = r.ok && r.body.status === "ok" ? r.body : { items: [], after: undefined };
        next[kind] = { items: body.items, after: body.after, loadingMore: false };
      });
      setGroups(next);
      setState("ready");
    });
  }, [accountId, debounced]);

  async function more(kind: Kind) {
    if (!accountId || !groups) return;
    const group = groups[kind];
    if (!group.after) return;
    const run = sequence.current;
    setGroups({ ...groups, [kind]: { ...group, loadingMore: true } });
    const result = await apiFetch<SearchResponse>(
      soundsUrl(accountId, kind, debounced, group.after),
    );
    if (run !== sequence.current) return;
    setGroups((current) => {
      if (!current) return current;
      const now = current[kind];
      if (!result.ok || result.body.status !== "ok")
        return { ...current, [kind]: { ...now, loadingMore: false } };
      return {
        ...current,
        [kind]: {
          items: [...now.items, ...result.body.items],
          after: result.body.after,
          loadingMore: false,
        },
      };
    });
  }

  function preview(sound: SoundChoice) {
    const element = audio.current;
    if (!element || !sound.previewUrl) return;
    if (playing === sound.audioId) {
      element.pause();
      setPlaying(null);
      return;
    }
    element.src = sound.previewUrl;
    setPlaying(sound.audioId);
    // A link that is not a playable file after all: open it instead.
    element.play().catch(() => {
      setPlaying(null);
      window.open(sound.previewUrl, "_blank", "noopener,noreferrer");
    });
  }

  /** Instagram's page plays the sound there: the one playing here stops. */
  function stopPreview() {
    audio.current?.pause();
    setPlaying(null);
  }

  const empty =
    state === "ready" &&
    groups !== null &&
    KINDS.every(({ kind }) => groups[kind].items.length === 0);

  return (
    <div className="mt-6">
      <p className="text-sm font-medium text-ink">{SOUND_LABEL}</p>
      <audio ref={audio} onEnded={() => setPlaying(null)} onError={() => setPlaying(null)} hidden />

      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={`mt-2 h-9 rounded-lg border px-4 text-sm transition-colors duration-150 ${
          value === null
            ? "border-ink bg-ink text-white"
            : "border-ink/15 bg-white text-ink hover:bg-ink/[0.04]"
        }`}
      >
        {NO_SOUND}
      </button>
      {value && (
        <p className="mt-2 text-sm text-ink">
          {chosenSoundLine(value.title)}
          <span className="mt-1 block text-xs text-ink/60">{mixLine(service, voiced)}</span>
        </p>
      )}

      {state === "reconnect" ? (
        <p className="mt-3 text-sm text-ink/70">{SOUND_RECONNECT}</p>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={SOUND_SEARCH_PLACEHOLDER}
            aria-label={SOUND_TAB_SEARCH}
            className="mt-3 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink placeholder:text-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          {debounced === "" && (
            <p className="mt-3 text-xs font-medium text-ink/55">{SOUND_TAB_TRENDING}</p>
          )}
          {state === "loading" && (
            <div className="mt-4 flex justify-center">
              <Spinner className="size-5 text-ink/40" />
            </div>
          )}
          {state === "error" && <p className="mt-3 text-sm text-ink/70">{SOUND_SEARCH_FAILED}</p>}
          {empty && <p className="mt-3 text-sm text-ink/60">{SOUND_NONE_FOUND}</p>}
          {state === "ready" &&
            groups &&
            KINDS.map(({ kind, title }) =>
              groups[kind].items.length === 0 ? null : (
                <section key={kind} className="mt-4">
                  <h3 className="text-xs font-semibold text-ink/60">{title}</h3>
                  <ul className="mt-2 divide-y divide-ink/[0.06] rounded-xl border border-ink/10 bg-white">
                    {groups[kind].items.map((sound) => {
                      const chosen = value?.audioId === sound.audioId;
                      const length = duration(sound.durationMs);
                      return (
                        <li
                          key={`${kind}:${sound.audioId}`}
                          className="flex items-center gap-3 p-2"
                        >
                          <SoundPreview
                            sound={sound}
                            playing={playing === sound.audioId}
                            onPlay={() => preview(sound)}
                            onOpenInstagram={stopPreview}
                          />
                          {sound.pictureUrl && (
                            // A Meta CDN link — next/image would refuse the host.
                            <img
                              src={sound.pictureUrl}
                              alt=""
                              className="size-9 shrink-0 rounded-md object-cover"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => onChange(chosen ? null : sound)}
                            aria-pressed={chosen}
                            className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-start transition-colors duration-150 ${
                              chosen ? "bg-accent/30" : "hover:bg-ink/[0.04]"
                            }`}
                          >
                            <span className="block truncate text-sm text-ink">
                              <bdi>{sound.title || "—"}</bdi>
                            </span>
                            <span className="flex gap-2 text-xs text-ink/55">
                              {sound.creator && <bdi className="truncate">{sound.creator}</bdi>}
                              {length && <span dir="ltr">{length}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {groups[kind].after && (
                    <button
                      type="button"
                      onClick={() => void more(kind)}
                      disabled={groups[kind].loadingMore}
                      className="mt-2 text-sm font-medium text-ink/70 underline-offset-4 hover:underline disabled:opacity-50"
                    >
                      {SOUND_MORE}
                    </button>
                  )}
                </section>
              ),
            )}
        </>
      )}

      <p className="mt-5 text-xs leading-relaxed text-ink/60">
        {SOUND_NOTE}{" "}
        <a
          href={downloadUrl}
          download
          aria-disabled={downloadUrl === undefined || undefined}
          className={`font-medium text-ink underline underline-offset-4 ${
            downloadUrl === undefined ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {SOUND_NOTE_DOWNLOAD}
        </a>
      </p>
    </div>
  );
}

/**
 * A row's preview control (decision 0108 §5). A file plays in place (▶/■); a
 * sound Meta gives no file for — its only link is Instagram's own page — keeps
 * its row, and its button says so and opens that page in a new tab. Exported
 * for the tests.
 */
export function SoundPreview({
  sound,
  playing,
  onPlay,
  onOpenInstagram,
}: {
  sound: SoundChoice;
  playing: boolean;
  onPlay: () => void;
  onOpenInstagram: () => void;
}) {
  if (!sound.previewUrl) {
    return (
      <span
        title={SOUND_NO_PREVIEW}
        aria-label={SOUND_NO_PREVIEW}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.03] text-ink/25"
      >
        <Play />
      </span>
    );
  }
  if (isInstagramPage(sound.previewUrl)) {
    return (
      <a
        href={sound.previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpenInstagram}
        className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink/[0.06] px-3 text-xs font-medium text-ink transition-colors duration-150 hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {SOUND_ON_INSTAGRAM}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={SOUND_PREVIEW_ARIA}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-ink hover:bg-ink/10"
    >
      {playing ? <Stop /> : <Play />}
    </button>
  );
}
