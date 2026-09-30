import { describe, expect, it } from "vitest";
import { validateLiteraryArtwork } from "../src/lib/literaryArtwork";

describe("literary artwork validation", () => {
  it("accepts a three-line haiku", () => {
    const result = validateLiteraryArtwork("First quiet line\nA second line arrives\nThe third settles", "haiku");
    expect(result.valid).toBe(true);
  });

  it("rejects truncated or verbose haiku output", () => {
    expect(validateLiteraryArtwork("Only one line", "haiku").valid).toBe(false);
    expect(validateLiteraryArtwork("One\nTwo\nThree\nCommentary", "haiku").valid).toBe(false);
  });

  it("rejects empty output and markdown wrappers", () => {
    expect(validateLiteraryArtwork("", "prose").valid).toBe(false);
    expect(validateLiteraryArtwork("```\npoem\n```", "poeme").valid).toBe(false);
  });

  it("accepts exactly fourteen sonnet lines", () => {
    const sonnet = Array.from({ length: 14 }, (_, i) => `Verse ${i + 1}`).join("\n");
    expect(validateLiteraryArtwork(sonnet, "sonnet").valid).toBe(true);
    expect(validateLiteraryArtwork(`${sonnet}\nVerse 15`, "sonnet").valid).toBe(false);
  });
});
