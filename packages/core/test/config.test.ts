import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envSchema, getEnv, resetEnvCache } from "../src/config";
import { tiktokAuthorizeUrl } from "../src/providers/tiktok";

/**
 * Every environment string is trimmed (PR 4.1). On 2026-10-17 a Vercel value
 * began with a newline and TikTok refused `client_key=%0A…`; a provider key must
 * not be breakable that way again, Meta's as much as TikTok's.
 */

// What a paste into Vercel or a CRLF .env line leaves at the ends of a value.
const DIRTY = ["\n", " ", "\r\n", "\t", " \n "];

// The one key whose parsed value is not the string itself.
const TRANSFORMED = new Set(["DRY_RUN"]);

describe("environment strings", () => {
  const saved = { ...process.env };

  beforeEach(() => resetEnvCache());
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    resetEnvCache();
  });

  it("every key of the schema is trimmed at both ends, so a new key cannot skip it", () => {
    const keys = Object.keys(envSchema.shape).filter((key) => !TRANSFORMED.has(key));
    // A schema this test no longer sees keys of would pass for nothing.
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) {
      for (const pad of DIRTY) {
        const parsed = envSchema.parse({ [key]: `${pad}value-of-${key}${pad}` }) as Record<
          string,
          unknown
        >;
        expect(parsed[key], `${key} padded with ${JSON.stringify(pad)}`).toBe(`value-of-${key}`);
      }
    }
  });

  it("covers the provider keys by name: Meta, TikTok, Resend, the database", () => {
    for (const key of [
      "META_APP_ID",
      "META_APP_SECRET",
      "TIKTOK_CLIENT_KEY",
      "TIKTOK_CLIENT_SECRET",
      "RESEND_API_KEY",
      "DATABASE_URL",
      "SOCIAL_TOKEN_KEY",
    ]) {
      expect(Object.keys(envSchema.shape)).toContain(key);
      process.env[key] = `\n${key}-value\r\n`;
    }
    resetEnvCache();
    const env = getEnv() as Record<string, unknown>;
    expect(env.META_APP_ID).toBe("META_APP_ID-value");
    expect(env.TIKTOK_CLIENT_KEY).toBe("TIKTOK_CLIENT_KEY-value");
    expect(env.TIKTOK_CLIENT_SECRET).toBe("TIKTOK_CLIENT_SECRET-value");
    expect(env.RESEND_API_KEY).toBe("RESEND_API_KEY-value");
    expect(env.DATABASE_URL).toBe("DATABASE_URL-value");
  });

  it("the authorize link TikTok refused on 2026-10-17 now carries a clean client_key", () => {
    process.env.TIKTOK_CLIENT_KEY = "\nsbawexample123\n";
    resetEnvCache();
    const url = tiktokAuthorizeUrl({ clientKey: getEnv().TIKTOK_CLIENT_KEY!, state: "s" });
    expect(new URL(url).searchParams.get("client_key")).toBe("sbawexample123");
    expect(url).not.toContain("%0A");
    expect(url).not.toContain("%0a");
  });

  it("an unset key stays unset, and an empty one stays empty", () => {
    delete process.env.RESEND_API_KEY;
    process.env.SENTRY_DSN = "";
    resetEnvCache();
    const env = getEnv();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.SENTRY_DSN).toBe("");
  });

  it("DRY_RUN reads a padded 1 or true as on, and anything else as off", () => {
    for (const [raw, expected] of [
      ["1", true],
      ["1\n", true],
      [" true\r\n", true],
      ["0\n", false],
      ["false", false],
      ["", false],
    ] as const) {
      expect(envSchema.parse({ DRY_RUN: raw }).DRY_RUN, JSON.stringify(raw)).toBe(expected);
    }
    expect(envSchema.parse({}).DRY_RUN).toBe(false);
  });

  it("WORKER_ID keeps its default and is trimmed", () => {
    expect(envSchema.parse({}).WORKER_ID).toBe("local");
    expect(envSchema.parse({ WORKER_ID: " box-1\n" }).WORKER_ID).toBe("box-1");
  });
});
