import { and, eq, isNotNull } from "drizzle-orm";
import { getConfigValue } from "../appConfig";
import { wordsPerSecondSchema } from "../config";
import type { Db } from "../db";
import { appConfig, audioRenders, scripts } from "../db/schema";

/**
 * Words-per-second calibration: the word budget is demo_seconds ×
 * app_config.words_per_second[voice], and the seed value (2.2) is a guess.
 * This reads what the voices actually did — ready audio renders against their
 * script's word count — instead of guessing a new constant.
 */

export interface VoiceWps {
  voiceId: string;
  samples: number;
  wordsPerSecond: number;
}

export async function observedWordsPerSecond(db: Db): Promise<VoiceWps[]> {
  const rows = await db
    .select({
      voiceId: audioRenders.voiceId,
      durationMs: audioRenders.durationMs,
      stretchRatio: audioRenders.stretchRatio,
      text: scripts.text,
    })
    .from(audioRenders)
    .innerJoin(scripts, eq(audioRenders.scriptId, scripts.id))
    .where(and(eq(audioRenders.status, "ready"), isNotNull(audioRenders.durationMs)));

  const byVoice = new Map<string, { words: number; seconds: number; samples: number }>();
  for (const row of rows) {
    // durationMs is post-atempo; × stretchRatio recovers the natural length.
    const seconds = ((row.durationMs ?? 0) * row.stretchRatio) / 1000;
    const words = row.text.trim().split(/\s+/).filter(Boolean).length;
    if (seconds <= 0 || words === 0) continue;
    const acc = byVoice.get(row.voiceId) ?? { words: 0, seconds: 0, samples: 0 };
    acc.words += words;
    acc.seconds += seconds;
    acc.samples += 1;
    byVoice.set(row.voiceId, acc);
  }

  return [...byVoice.entries()]
    .map(([voiceId, acc]) => ({
      voiceId,
      samples: acc.samples,
      wordsPerSecond: Math.round((acc.words / acc.seconds) * 100) / 100,
    }))
    .sort((a, b) => b.samples - a.samples);
}

/**
 * Merge observed per-voice rates into app_config.words_per_second, keeping the
 * `default` key and any voice not observed. Voices under `minSamples` are
 * skipped — one render is an anecdote, not a rate. Returns the voices written.
 */
export async function applyWordsPerSecond(
  db: Db,
  observed: VoiceWps[],
  minSamples = 3,
): Promise<string[]> {
  const current = await getConfigValue(db, "words_per_second", wordsPerSecondSchema);
  const applied: string[] = [];
  for (const voice of observed) {
    if (voice.samples < minSamples) continue;
    current[voice.voiceId] = voice.wordsPerSecond;
    applied.push(voice.voiceId);
  }
  if (applied.length > 0) {
    await db
      .update(appConfig)
      .set({ value: current, updatedAt: new Date() })
      .where(eq(appConfig.key, "words_per_second"));
  }
  return applied;
}
