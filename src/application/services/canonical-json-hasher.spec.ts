import { describe, expect, it } from "bun:test";
import { CanonicalJsonHasher } from "./canonical-json-hasher";

describe("CanonicalJsonHasher", () => {
  it("should produce the identical hash regardless of key order", () => {
    const payload1 = {
      providerId: "provider-a",
      roundId: "round-1",
      money: { amount: "25.00", currency: "BRL" },
      gameId: "chimp",
    };

    const payload2 = {
      gameId: "chimp",
      money: { currency: "BRL", amount: "25.00" },
      providerId: "provider-a",
      roundId: "round-1",
    };

    const hash1 = CanonicalJsonHasher.hash(payload1);
    const hash2 = CanonicalJsonHasher.hash(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 em hex
  });

  it("should produce different hashes for different payloads", () => {
    const payload1 = {
      providerId: "provider-a",
      money: { amount: "25.00", currency: "BRL" },
    };

    const payload2 = {
      providerId: "provider-a",
      money: { amount: "25.01", currency: "BRL" },
    };

    expect(CanonicalJsonHasher.hash(payload1)).not.toBe(
      CanonicalJsonHasher.hash(payload2),
    );
  });
});

