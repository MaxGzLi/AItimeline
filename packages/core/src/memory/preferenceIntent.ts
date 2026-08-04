/**
 * Deterministic one-sentence preference intent parsing. The base-view chat
 * turns "我最近想搞懂 ___" style sentences into a single learn_topic intent;
 * anything else is rejected so the caller can honestly say it did not
 * understand. No model is involved, so the path works fully offline.
 */

export interface LearnTopicPreferenceIntent {
  kind: "learn_topic";
  topic: string;
}

const maxTopicLength = 60;

/**
 * Sprint scope is a single intent: "I want to figure out ___". Triggers cover
 * 想搞懂 / 想学 / 关注 / 最近在研究 plus close variants, and their English
 * equivalents. Longest alternatives come first so 学习 wins over 学.
 */
const zhTriggerPattern =
  /(?:想(?:搞懂|搞明白|搞清楚|弄懂|弄明白|学习|学会|学|了解|研究)|在(?:研究|学习|琢磨)|关注)\s*(.+)$/u;
const enTriggerPattern =
  /(?:want(?:ed)?\s+to\s+(?:understand|figure\s+out|learn(?:\s+about)?|study|dig\s+into)|interested\s+in|been\s+(?:studying|researching|learning(?:\s+about)?)|focus(?:ing)?\s+on)\s+(.+)$/iu;

export function parsePreferenceIntent(text: string): LearnTopicPreferenceIntent | null {
  const normalized = typeof text === "string" ? text.trim() : "";

  if (!normalized) {
    return null;
  }

  const matched = zhTriggerPattern.exec(normalized) ?? enTriggerPattern.exec(normalized);

  if (!matched) {
    return null;
  }

  const topic = cleanTopic(matched[1]);

  return topic ? { kind: "learn_topic", topic } : null;
}

function cleanTopic(raw: string): string | null {
  let topic = raw.trim();

  // Leading fillers ("关注一下 X") are not part of the topic.
  topic = topic.replace(/^(?:一下|一点)\s*/u, "");
  // The topic ends at the first clause break; a trailing ramble is not a topic.
  topic = topic.split(/[,,。;;!!??\n]/u)[0] ?? "";
  topic = topic.replace(/[\s.。!!??~~、]+$/gu, "");
  topic = topic.replace(/(?:吧|呢|啊|呀|哈|了)$/u, "");
  topic = topic.replace(/\s+(?:lately|recently|these\s+days)$/iu, "");
  topic = topic.replace(/^[「『"'“”]+/u, "").replace(/[」』"'“”]+$/u, "");
  topic = topic.trim();

  if (!topic || topic.length > maxTopicLength) {
    return null;
  }

  return topic;
}
