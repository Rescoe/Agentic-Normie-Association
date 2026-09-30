import { describe, expect, it } from "vitest";
import { modelForOneMinAiTask, textArtworkGuard } from "../src/lib/oneMinAi";

describe("1min.ai critical model routing", () => {
  it("uses DeepSeek Flash for persisted outputs by default", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(modelForOneMinAiTask("art-text", env)).toBe("deepseek-flash");
    expect(modelForOneMinAiTask("structured", env)).toBe("deepseek-flash");
    expect(modelForOneMinAiTask("news", env)).toBe("deepseek-flash");
    expect(modelForOneMinAiTask("code", env)).toBe("deepseek-flash");
  });

  it("keeps salon fallback independently configurable", () => {
    expect(modelForOneMinAiTask("chat", {} as NodeJS.ProcessEnv)).toBe("gpt-4o-mini");
    expect(modelForOneMinAiTask("chat", { ONE_MIN_AI_CHAT_MODEL: "custom-chat" } as NodeJS.ProcessEnv)).toBe("custom-chat");
  });

  it("supports task-specific model overrides", () => {
    const env = {
      ONE_MIN_AI_ART_TEXT_MODEL: "art-model",
      ONE_MIN_AI_STRUCTURED_MODEL: "json-model",
      ONE_MIN_AI_NEWS_MODEL: "news-model",
      ONE_MIN_AI_CODE_MODEL: "code-model",
    } as NodeJS.ProcessEnv;
    expect(modelForOneMinAiTask("art-text", env)).toBe("art-model");
    expect(modelForOneMinAiTask("structured", env)).toBe("json-model");
    expect(modelForOneMinAiTask("news", env)).toBe("news-model");
    expect(modelForOneMinAiTask("code", env)).toBe("code-model");
  });

  it("gives haiku and sonnet explicit structural guards", () => {
    expect(textArtworkGuard("haiku")).toContain("exactly 3");
    expect(textArtworkGuard("sonnet")).toContain("exactly 14");
  });
});
