import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import { openSecret, sealSecret, SecretBoxError, socialTokenAad } from "../src/secret-box";

/**
 * The token seal (decision 0101): AES-256-GCM under SOCIAL_TOKEN_KEY with the
 * row's identity as AAD. What is pinned: a round trip, that the AAD binds the
 * ciphertext to its row, that tampering is refused, and that a missing or
 * short key fails at use with a plain message.
 */
describe("secret-box", () => {
  const key = randomBytes(32).toString("base64");
  const aad = socialTokenAad({ userId: "u1", platform: "instagram", externalId: "ig1" });

  beforeAll(() => {
    process.env.SOCIAL_TOKEN_KEY = key;
    resetEnvCache();
  });

  afterAll(() => {
    delete process.env.SOCIAL_TOKEN_KEY;
    resetEnvCache();
  });

  it("round-trips a token and never stores it in the clear", () => {
    const sealed = sealSecret("EAAB-page-token-secret", aad);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("EAAB");
    expect(sealed.split(".")).toHaveLength(4);
    expect(openSecret(sealed, aad)).toBe("EAAB-page-token-secret");
  });

  it("two seals of the same token differ (random iv) and both open", () => {
    const a = sealSecret("same", aad);
    const b = sealSecret("same", aad);
    expect(a).not.toBe(b);
    expect(openSecret(a, aad)).toBe("same");
    expect(openSecret(b, aad)).toBe("same");
  });

  it("refuses a ciphertext moved to another row (the AAD does not match)", () => {
    const sealed = sealSecret("token", aad);
    const other = socialTokenAad({ userId: "u2", platform: "instagram", externalId: "ig1" });
    expect(() => openSecret(sealed, other)).toThrow(SecretBoxError);
    expect(() => openSecret(sealed, other)).toThrow(/authenticate/);
  });

  it("refuses a tampered ciphertext and an unknown shape", () => {
    const sealed = sealSecret("token", aad);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    parts[3] = flipped.toString("base64url");
    expect(() => openSecret(parts.join("."), aad)).toThrow(SecretBoxError);
    expect(() => openSecret("v0.a.b.c", aad)).toThrow(/unknown shape/);
    expect(() => openSecret("not sealed at all", aad)).toThrow(/unknown shape/);
    // A truncated or hand-edited column: our error, not Node's.
    expect(() => openSecret(`v1.${parts[1]!.slice(0, 4)}.${parts[2]}.${parts[3]}`, aad)).toThrow(
      SecretBoxError,
    );
    expect(() => openSecret(`v1.${parts[1]}.${parts[2]!.slice(0, 4)}.${parts[3]}`, aad)).toThrow(
      /unknown shape/,
    );
  });

  it("fails at use, not at import, when the key is missing or the wrong size", () => {
    delete process.env.SOCIAL_TOKEN_KEY;
    resetEnvCache();
    expect(() => sealSecret("token", aad)).toThrow(/SOCIAL_TOKEN_KEY is not set/);
    process.env.SOCIAL_TOKEN_KEY = randomBytes(16).toString("base64");
    resetEnvCache();
    expect(() => sealSecret("token", aad)).toThrow(/32 bytes/);
    process.env.SOCIAL_TOKEN_KEY = key;
    resetEnvCache();
  });
});
