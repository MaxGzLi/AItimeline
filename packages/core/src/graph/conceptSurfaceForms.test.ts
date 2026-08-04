import { describe, expect, it } from "vitest";
import { buildConceptSurfaceForms, textMentionsSurfaceForm } from "./conceptSurfaceForms.js";

describe("buildConceptSurfaceForms initialisms", () => {
  it("reads a hyphenated compound both ways so MoE and MLA are both produced", () => {
    // "Mixture-of-Experts" is written MoE (every hyphen segment counts) while
    // "Multi-head Latent Attention" is written MLA (the compound counts once).
    expect(buildConceptSurfaceForms("Mixture-of-Experts")).toEqual(["MoE", "混合专家", "专家混合"]);
    expect(buildConceptSurfaceForms("Multi-head Latent Attention")).toEqual(
      expect.arrayContaining(["MLA", "MhLA", "多头潜在注意力"])
    );
  });

  it("refuses two-letter initialisms, which would collide with ordinary text", () => {
    // "ReAct Loop" -> "RL" would claim every question mentioning reinforcement
    // learning; "Deep Dive" -> "DD" would claim arbitrary noise.
    expect(buildConceptSurfaceForms("ReAct Loop")).toEqual([]);
    expect(buildConceptSurfaceForms("Deep Dive")).toEqual([]);
  });

  it("refuses an initialism longer than six letters", () => {
    expect(buildConceptSurfaceForms("Reliable Extremely Long Winded Concept Name Here Now")).toEqual([]);
  });

  it("produces nothing extra for a single-word concept", () => {
    expect(buildConceptSurfaceForms("Transformer")).toEqual([]);
  });

  it("takes an author-supplied abbreviation out of parentheses and keeps the bare phrase", () => {
    const forms = buildConceptSurfaceForms("Mixture-of-Experts (MoE)");

    expect(forms).toContain("MoE");
    expect(forms).toContain("Mixture-of-Experts");
    // "MoEM" would come from running the initialism over the parenthetical too.
    expect(forms).not.toContain("MoEM");
  });
});

describe("buildConceptSurfaceForms Chinese wordings", () => {
  it("maps a Chinese wording onto the English concept without renaming it", () => {
    expect(buildConceptSurfaceForms("Sparse Activation")).toEqual(["稀疏激活"]);
  });

  it("matches the concept key case-insensitively", () => {
    expect(buildConceptSurfaceForms("FINE-TUNING")).toContain("微调");
  });

  it("has no wording for a concept outside the curated glossary", () => {
    expect(buildConceptSurfaceForms("International Seabed Authority")).toEqual(["ISA"]);
  });
});

describe("textMentionsSurfaceForm word boundaries", () => {
  it("matches an abbreviation flush against Chinese prose", () => {
    expect(textMentionsSurfaceForm("多个moe之间如何配合", "MoE")).toBe(true);
  });

  it("rejects an abbreviation buried inside a longer ASCII word", () => {
    expect(textMentionsSurfaceForm("MLAB 这个工具", "MLA")).toBe(false);
    expect(textMentionsSurfaceForm("在 XMLA 里", "MLA")).toBe(false);
  });

  it("accepts a plural but not an arbitrary suffix", () => {
    expect(textMentionsSurfaceForm("how many LLMs are there", "LLM")).toBe(true);
    expect(textMentionsSurfaceForm("LLMses is not a word", "LLM")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(textMentionsSurfaceForm("what is mla exactly", "MLA")).toBe(true);
  });

  it("still matches when the boundary is punctuation", () => {
    expect(textMentionsSurfaceForm("MLA是什么？", "MLA")).toBe(true);
    expect(textMentionsSurfaceForm("(MoE) 的开销", "MoE")).toBe(true);
  });
});
