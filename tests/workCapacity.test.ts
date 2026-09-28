import { describe, expect, it } from "vitest";
import { maxConcurrentCreativeWorks } from "../src/lib/workStore";

describe("membership-based creative capacity", () => {
  it.each([
    [0, 1],
    [1, 1],
    [3, 1],
    [4, 2],
    [6, 2],
    [7, 3],
    [12, 4],
    [13, 5],
    [1000, 5],
  ])("allows %i members to sustain %i concurrent work(s)", (members, expected) => {
    expect(maxConcurrentCreativeWorks(members)).toBe(expected);
  });
});
