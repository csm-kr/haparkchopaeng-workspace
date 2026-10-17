// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertGrantUsable, hashCredential, pairingCode, sameCredential, validateDeviceToken } from "../security";

describe("local connector credentials and execution permission", () => {
  it("six digits preserve leading zeroes and change with the attempt and server key", () => {
    const code = pairingCode("attempt-one", "test-server-secret");
    expect(code).toMatch(/^\d{6}$/);
    expect(pairingCode("attempt-one", "test-server-secret")).toBe(code);
    expect(pairingCode("attempt-two", "test-server-secret")).not.toBe(code);
    expect(pairingCode("attempt-one", "rotated-server-secret")).not.toBe(code);
  });

  it("does not accept short device keys or confuse a credential with its stored hash", () => {
    const token = Buffer.alloc(32, 7).toString("base64url");
    expect(validateDeviceToken(token)).toBe(true);
    expect(validateDeviceToken("482107")).toBe(false);
    const hash = hashCredential(token);
    expect(hash).not.toContain(token);
    expect(sameCredential(token, hash)).toBe(true);
    expect(sameCredential("wrong", hash)).toBe(false);
    expect(sameCredential(hash, hash)).toBe(false);
  });

  it("blocks a claim or result exactly at expiry and after explicit revocation", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    expect(() => assertGrantUsable({ revokedAt: null, leaseExpiresAt: now }, now)).toThrow();
    expect(() => assertGrantUsable({ revokedAt: now, leaseExpiresAt: new Date(now.getTime() + 45_000) }, now)).toThrow();
    expect(() => assertGrantUsable({ revokedAt: null, leaseExpiresAt: new Date(now.getTime() + 1) }, now)).not.toThrow();
  });
});
