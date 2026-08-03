import { describe, expect, it } from "vitest";
import { findOpportunities, OPPORTUNITIES } from "./catalog";

describe("navigator", () => {
  it("finds permits for a Buffalo restaurant patio", () => expect(findOpportunities("Open a Buffalo restaurant with a patio")[0]?.id).toBe("buffalo-permits"));
  it("finds public procurement for a contractor", () => expect(findOpportunities("Construction contractor bidding on public work").some(({ kind }) => kind === "procurement")).toBe(true));
  it("finds seed support for a software startup", () => expect(findOpportunities("Software startup raising a seed investment")[0]?.id).toBe("seed"));
  it("keeps official sources attached", () => expect(OPPORTUNITIES.every(({ sourceUrl }) => sourceUrl.startsWith("https://"))).toBe(true));
});
