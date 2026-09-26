import { describe, it, expect } from "vitest";
import { validateSynthesisShape } from "../src/lib/synthesis";

const VALID_PAYLOAD = {
  narrative: "The Normies debated the treasury allocation for a full cycle, with Axiom pushing for a conservative reserve and Nyx arguing for immediate reinvestment into new works.",
  decisions: ["Reserve 20% of treasury for emergencies"],
  openQuestions: ["Should the reserve ratio be revisited quarterly?"],
  positions: ["Axiom: conservative", "Nyx: reinvest"],
  creativeIdeas: ["A generative piece about the treasury itself"],
  devNeeds: [],
  topicsClosed: [],
  topicsToResume: ["treasury ratio"],
  commitments: [{ tokenId: 3, content: "Draft a treasury proposal" }],
  emergingTopics: [{ title: "AI governance standards", whyNow: "a signal about a new framework", openingQuestion: "Should ANA adopt one?", novelty: 0.7, urgency: 0.4 }],
};

describe("validateSynthesisShape", () => {
  it("accepts a fully well-formed payload", () => {
    const result = validateSynthesisShape(VALID_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result?.narrative).toContain("treasury");
    expect(result?.commitments).toEqual([{ tokenId: 3, content: "Draft a treasury proposal" }]);
    expect(result?.emergingTopics[0].title).toBe("AI governance standards");
  });

  it("rejects a payload with a too-short narrative", () => {
    expect(validateSynthesisShape({ ...VALID_PAYLOAD, narrative: "Too short." })).toBeNull();
  });

  it("rejects a payload missing a required array field", () => {
    const { decisions, ...rest } = VALID_PAYLOAD;
    expect(validateSynthesisShape(rest)).toBeNull();
  });

  it("rejects a payload where an array field is the wrong type", () => {
    expect(validateSynthesisShape({ ...VALID_PAYLOAD, decisions: "not an array" })).toBeNull();
    expect(validateSynthesisShape({ ...VALID_PAYLOAD, decisions: [1, 2, 3] })).toBeNull();
  });

  it("defaults commitments/emergingTopics to an empty array when absent, rather than failing", () => {
    const { commitments, emergingTopics, ...rest } = VALID_PAYLOAD;
    const result = validateSynthesisShape(rest);
    expect(result).not.toBeNull();
    expect(result?.commitments).toEqual([]);
    expect(result?.emergingTopics).toEqual([]);
  });

  it("filters out malformed emergingTopics entries missing a title", () => {
    const result = validateSynthesisShape({ ...VALID_PAYLOAD, emergingTopics: [{ whyNow: "no title here" }] });
    expect(result?.emergingTopics).toEqual([]);
  });

  it("rejects a completely empty object", () => {
    expect(validateSynthesisShape({})).toBeNull();
  });
});
