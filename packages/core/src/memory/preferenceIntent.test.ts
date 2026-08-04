import { describe, expect, it } from "vitest";
import { parsePreferenceIntent } from "./preferenceIntent.js";

describe("parsePreferenceIntent", () => {
  it("parses the demo sentence 我最近想搞懂 ___", () => {
    expect(parsePreferenceIntent("我最近想搞懂强化学习")).toEqual({
      kind: "learn_topic",
      topic: "强化学习"
    });
  });

  it("parses 想学 / 关注 / 最近在研究 variants", () => {
    expect(parsePreferenceIntent("想学 RLHF")).toEqual({ kind: "learn_topic", topic: "RLHF" });
    expect(parsePreferenceIntent("关注一下多模态大模型")).toEqual({
      kind: "learn_topic",
      topic: "多模态大模型"
    });
    expect(parsePreferenceIntent("我最近在研究智能体记忆")).toEqual({
      kind: "learn_topic",
      topic: "智能体记忆"
    });
  });

  it("strips trailing punctuation, particles and quotes", () => {
    expect(parsePreferenceIntent("我想搞懂 RAG。")).toEqual({ kind: "learn_topic", topic: "RAG" });
    expect(parsePreferenceIntent("我最近想搞懂「世界模型」吧")).toEqual({
      kind: "learn_topic",
      topic: "世界模型"
    });
  });

  it("cuts the topic at the first clause break", () => {
    expect(parsePreferenceIntent("我最近想搞懂强化学习,别再推产品新闻了")).toEqual({
      kind: "learn_topic",
      topic: "强化学习"
    });
  });

  it("parses English equivalents", () => {
    expect(parsePreferenceIntent("I want to understand reinforcement learning")).toEqual({
      kind: "learn_topic",
      topic: "reinforcement learning"
    });
    expect(parsePreferenceIntent("I've been researching world models lately.")).toEqual({
      kind: "learn_topic",
      topic: "world models"
    });
  });

  it("rejects sentences without a supported trigger", () => {
    expect(parsePreferenceIntent("今天天气不错")).toBeNull();
    expect(parsePreferenceIntent("give me more news")).toBeNull();
  });

  it("rejects empty input and empty topics", () => {
    expect(parsePreferenceIntent("")).toBeNull();
    expect(parsePreferenceIntent("   ")).toBeNull();
    expect(parsePreferenceIntent("我最近想搞懂")).toBeNull();
    expect(parsePreferenceIntent("我最近想搞懂。")).toBeNull();
  });

  it("rejects topics longer than 60 characters as not-a-topic", () => {
    expect(parsePreferenceIntent(`我想搞懂${"很".repeat(61)}`)).toBeNull();
  });
});
