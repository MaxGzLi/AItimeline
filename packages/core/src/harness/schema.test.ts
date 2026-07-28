import { describe, expect, it } from "vitest";
import type { KnowledgePost } from "../types.js";
import { validateKnowledgePost } from "./schema.js";

function makeValidPost(): KnowledgePost {
  return {
    id: "post-1",
    title: "Grounded retrieval",
    hook: "Retrieval quality depends on grounded evidence.",
    thesis: "Citations connect a generated card to source evidence.",
    shortBody: "A cited chunk lets readers trace the card back to its source.",
    summary: "Grounded cards retain source-level provenance.",
    keyTakeaway: "Keep citations attached to generated knowledge.",
    concepts: ["Grounding"],
    sources: [
      {
        id: "source-1",
        title: "Grounding source",
        url: "https://example.com/grounding",
        type: "article"
      }
    ],
    citations: [{ sourceId: "source-1", chunkId: "chunk-1" }],
    recommendedBecause: "This card explains source-grounded generation.",
    trustState: "supported",
    createdAt: "2026-07-28T00:00:00.000Z",
    estimatedReadMinutes: 2,
    difficulty: "beginner",
    confidence: "high",
    thread: [
      {
        id: "thread-1",
        kind: "user_comment",
        title: "Why citations matter",
        body: "Citations preserve a path from the card to its supporting source."
      }
    ],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: ["continue_deeper"],
    harnessVersion: "harness-v0"
  };
}

describe("knowledge post schema validation", () => {
  it("rejects a post when a required field is missing", () => {
    const { title: _title, ...withoutTitle } = makeValidPost();
    const result = validateKnowledgePost(withoutTitle);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "$.title",
      message: "title must be a non-empty string.",
      severity: "error"
    });
  });

  it("rejects a post when a field has the wrong type", () => {
    const result = validateKnowledgePost({
      ...makeValidPost(),
      estimatedReadMinutes: "2"
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "$.estimatedReadMinutes",
      message: "estimatedReadMinutes must be a positive number.",
      severity: "error"
    });
  });

  it("accepts a post with every required field and valid field types", () => {
    const result = validateKnowledgePost(makeValidPost());

    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("accepts a post imported from a conversation source", () => {
    const post = makeValidPost();
    post.sources[0]!.type = "conversation";

    const result = validateKnowledgePost(post);

    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
