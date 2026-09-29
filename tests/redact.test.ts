import { describe, it, expect, afterEach } from "vitest";
import { redactSecrets, cleanDiagnosticText } from "../src/lib/redact";

const SECRET = "SECRET_TEST_VALUE_abc123";

describe("redactSecrets — P0 secret-leak fix (29/09/2026 incident)", () => {
  it("required test: a fake RPC URL with a key in the /v2/ path never leaks the value", () => {
    const raw = `RPC call failed: Error: fetch failed for https://provider.example/v2/${SECRET} (ETIMEDOUT)`;
    const cleaned = redactSecrets(raw);
    expect(cleaned).not.toContain(SECRET);
    expect(cleaned).toContain("[REDACTED]");
    expect(cleaned).toContain("provider.example"); // keeps enough context to be useful for debugging
  });

  it("redacts a query-string key/token/secret parameter", () => {
    expect(redactSecrets(`GET https://api.example.com/v1/data?apiKey=${SECRET}&x=1`)).not.toContain(SECRET);
    expect(redactSecrets(`https://api.example.com/v1/data?token=${SECRET}`)).not.toContain(SECRET);
  });

  it("redacts an inline Authorization/Bearer token", () => {
    expect(redactSecrets(`failed with Authorization: Bearer ${SECRET}`)).not.toContain(SECRET);
  });

  it("never touches an ordinary transaction hash or contract address (not secret, must stay visible)", () => {
    const txHash = "0x4891ac7317232af1f17c291be6d0604c779961c4f2742ad1986da5f594947ac0";
    const addr   = "0xcc1ee5b126a9ca4d6c6f4506e373aa0bf26f1d22";
    expect(redactSecrets(`published tx ${txHash} for collection ${addr}`)).toBe(`published tx ${txHash} for collection ${addr}`);
  });

  it("is idempotent — safe to apply at more than one layer", () => {
    const raw = `oops https://x.example/v2/${SECRET}`;
    const once  = redactSecrets(raw);
    const twice = redactSecrets(once);
    expect(twice).toBe(once);
  });

  describe("exact configured secret env values", () => {
    const ORIGINAL = process.env.BASE_RPC_URL;
    afterEach(() => { process.env.BASE_RPC_URL = ORIGINAL; });

    it("redacts the exact configured BASE_RPC_URL wherever it appears, even outside the /v2/ pattern", () => {
      process.env.BASE_RPC_URL = `https://my-custom-provider.example/rpc/${SECRET}`;
      const cleaned = redactSecrets(`error calling ${process.env.BASE_RPC_URL}: timeout`);
      expect(cleaned).not.toContain(SECRET);
      expect(cleaned).not.toContain(process.env.BASE_RPC_URL!);
    });
  });

  it("cleanDiagnosticText also truncates, and returns undefined for empty input", () => {
    expect(cleanDiagnosticText(undefined)).toBeUndefined();
    expect(cleanDiagnosticText("")).toBeUndefined();
    const long = "a".repeat(1000);
    expect(cleanDiagnosticText(long, 50)!.length).toBe(50);
  });
});
