import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "./config";
import { PermanentError } from "./jobs/errors";

/**
 * Encryption at rest for the platform tokens social_accounts holds (decision
 * 0101): AES-256-GCM under SOCIAL_TOKEN_KEY, with the row's identity as
 * additional authenticated data so a ciphertext lifted from one row cannot be
 * opened as another's. App-level rather than pgcrypto: the live project has
 * pgcrypto as a platform default but no migration declares it, PGlite tests
 * could not run it, and a SQL-side key travels inside statements Postgres can
 * log.
 *
 * Wire format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version
 * prefix is what lets a future key rotation or algorithm change read old rows.
 *
 * The key is read at USE time, not module load, so processes that never open a
 * token (admin, the CLI) run without it and a missing key fails one request
 * with a plain message instead of the whole boot.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Permanent for the job queue: a missing or wrong key and a corrupted row are
 * configuration faults no retry fixes, so a job fails on its first attempt with
 * the real message on `last_error` instead of blaming the platform after five.
 */
export class SecretBoxError extends PermanentError {}

function key(): Buffer {
  const raw = getEnv().SOCIAL_TOKEN_KEY;
  if (!raw) throw new SecretBoxError("SOCIAL_TOKEN_KEY is not set");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new SecretBoxError("SOCIAL_TOKEN_KEY must be 32 bytes, base64-encoded");
  }
  return bytes;
}

export function sealSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function openSecret(sealed: string, aad: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError("sealed value has an unknown shape");
  }
  const [, iv, tag, ciphertext] = parts as [string, string, string, string];
  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new SecretBoxError("sealed value has an unknown shape");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), ivBytes);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    if (err instanceof SecretBoxError) throw err;
    // GCM's one failure: the tag did not verify — a tampered ciphertext, a
    // moved row (wrong AAD) or the wrong key. Nothing of the plaintext leaks.
    throw new SecretBoxError("sealed value failed to authenticate");
  }
}

/** The one place the AAD for a social account's tokens is spelled. */
export function socialTokenAad(account: {
  userId: string;
  platform: string;
  externalId: string;
}): string {
  return `social_accounts:${account.userId}:${account.platform}:${account.externalId}`;
}
