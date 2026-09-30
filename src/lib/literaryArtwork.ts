export interface LiteraryValidation {
  valid: boolean;
  text: string;
  error?: string;
}

export function validateLiteraryArtwork(raw: string | null | undefined, form?: string): LiteraryValidation {
  const text = (raw ?? "").trim();
  if (!text) return { valid: false, text: "", error: "empty literary output" };
  if (/^```|```$/m.test(text)) return { valid: false, text, error: "literary output contains markdown fences" };

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (form === "haiku" && lines.length !== 3) {
    return { valid: false, text, error: `haiku must contain exactly 3 non-empty lines (got ${lines.length})` };
  }
  if (form === "sonnet" && lines.length !== 14) {
    return { valid: false, text, error: `sonnet must contain exactly 14 non-empty lines (got ${lines.length})` };
  }
  if (text.length > 20_000) return { valid: false, text, error: "literary output exceeds 20,000 characters" };
  return { valid: true, text };
}
