import { normalizeConceptKey, normalizeConceptLabel } from "./conceptAliases.js";

/**
 * Extra ways a user may write a concept whose canonical name is a long English
 * phrase. Concept identity itself stays in English on purpose (the grounding
 * gate requires the concept to appear verbatim in the English source), so these
 * forms only exist to recognise a mention — never to rename a concept.
 */
export function buildConceptSurfaceForms(concept: string): string[] {
  const label = normalizeConceptLabel(concept);

  if (!label) {
    return [];
  }

  const forms = new Set<string>();
  const add = (value: string) => {
    const candidate = normalizeConceptLabel(value);

    if (candidate.length >= minSurfaceFormLength && normalizeConceptKey(candidate) !== normalizeConceptKey(label)) {
      forms.add(candidate);
    }
  };

  const parenthetical = label.match(/[(（]\s*([^)）]+?)\s*[)）]/);
  const bare = label.replace(/[(（][^)）]*[)）]/g, " ").replace(/\s+/g, " ").trim();

  if (parenthetical) {
    // "Mixture-of-Experts (MoE)" carries its own abbreviation, and the phrase
    // without it is what other cards store as the concept name.
    add(parenthetical[1]);
    add(bare);
  }

  // Derive from the phrase without its parenthetical: initials of
  // "Mixture-of-Experts (MoE)" would otherwise spell "MoEM".
  for (const initialism of buildInitialisms(bare)) {
    add(initialism);
  }

  for (const chinese of chineseAliasesByConceptKey.get(normalizeConceptKey(bare)) ?? []) {
    add(chinese);
  }

  return Array.from(forms);
}

/**
 * Case-insensitive containment that refuses matches buried inside a longer
 * word. The edge check is only demanded where the needle itself has an ASCII
 * word character, so "MoE" cannot match inside "MoEncoder" while it still
 * matches flush against Chinese prose ("多个moe之间"). A trailing plural "s" is
 * allowed so "LLMs" still counts as a mention of "LLM".
 */
export function textMentionsSurfaceForm(text: string, surfaceForm: string): boolean {
  const haystack = text.toLowerCase();
  const needle = surfaceForm.toLowerCase();

  if (!needle) {
    return false;
  }

  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + 1)) {
    if (hasCompatibleEdges(haystack, needle, index)) {
      return true;
    }
  }

  return false;
}

function hasCompatibleEdges(haystack: string, needle: string, start: number): boolean {
  if (isAsciiWordCharacter(needle[0]) && isAsciiWordCharacter(haystack[start - 1])) {
    return false;
  }

  if (!isAsciiWordCharacter(needle[needle.length - 1])) {
    return true;
  }

  const end = start + needle.length;
  const next = haystack[end];

  if (!isAsciiWordCharacter(next)) {
    return true;
  }

  return next === "s" && !isAsciiWordCharacter(haystack[end + 1]);
}

/**
 * Two readings of the same phrase, because usage is inconsistent about
 * hyphenated compounds: "Multi-head Latent Attention" is written MLA (the
 * compound counts once) while "Mixture-of-Experts" is written MoE (every
 * segment counts). Generate both and let the question decide.
 */
function buildInitialisms(phrase: string): string[] {
  const initialisms: string[] = [];

  for (const separator of [/\s+/, /[\s\-–—_/]+/]) {
    const initials = phrase
      .split(separator)
      .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
      .map((part) => part[0])
      .join("");

    // Two letters is where invented abbreviations start colliding with ordinary
    // text ("ReAct Loop" would claim every "RL"), so the floor stays at three.
    if (
      initials.length >= minInitialismLength &&
      initials.length <= maxInitialismLength &&
      /^\p{L}/u.test(initials)
    ) {
      initialisms.push(initials);
    }
  }

  return initialisms;
}

function isAsciiWordCharacter(character: string | undefined): boolean {
  return character ? asciiWordCharacter.test(character) : false;
}

const asciiWordCharacter = /[A-Za-z0-9_]/;
const minSurfaceFormLength = 2;
const minInitialismLength = 3;
const maxInitialismLength = 6;

// Display/matching layer only: a Chinese reader types 「稀疏激活」, the library
// stores "Sparse Activation". Entries are limited to AI terms whose Chinese
// wording is unambiguous, so a hit here means the user really did name the
// concept.
const chineseAliases: Array<[string, string[]]> = [
  ["Mixture-of-Experts", ["混合专家", "专家混合"]],
  ["Sparse Activation", ["稀疏激活"]],
  ["Shared Experts", ["共享专家"]],
  ["Fine-grained Experts", ["细粒度专家"]],
  ["Auxiliary-loss-free Load Balancing", ["无辅助损失负载均衡", "负载均衡"]],
  ["Multi-head Latent Attention", ["多头潜在注意力", "潜在注意力"]],
  ["Multi-Head Attention", ["多头注意力"]],
  ["Group-Query Attention", ["分组查询注意力"]],
  ["Multi-Query Attention", ["多查询注意力"]],
  ["Multi-Token Prediction", ["多词元预测", "多token预测", "多 token 预测"]],
  ["KV Cache", ["kv缓存", "kv 缓存", "键值缓存"]],
  ["Large Language Model", ["大语言模型", "大模型"]],
  ["AI Agent", ["智能体"]],
  ["Multi-Agent System", ["多智能体系统"]],
  ["Machine Learning", ["机器学习"]],
  ["Reinforcement Learning", ["强化学习"]],
  ["fine-tuning", ["微调"]],
  ["Pre-training", ["预训练"]],
  ["Pre-training Corpus", ["预训练语料"]],
  ["Retrieval Augmented Generation", ["检索增强生成"]],
  ["Retrieval-Augmented Generation", ["检索增强生成"]],
  ["Tokenizer", ["分词器"]],
  ["Byte-level BPE", ["字节级bpe", "字节级 bpe"]],
  ["Byte Pair Encoding", ["字节对编码"]],
  ["alignment", ["对齐"]],
  ["Diffusion Models", ["扩散模型"]],
  ["Knowledge Graph", ["知识图谱"]],
  ["Knowledge Base Construction", ["知识库构建"]],
  ["Inference Efficiency", ["推理效率"]],
  ["Quantization", ["量化"]],
  ["Knowledge Distillation", ["知识蒸馏"]],
  ["Context Window", ["上下文窗口"]],
  ["Prompt Engineering", ["提示工程", "提示词工程"]],
  ["Speculative Decoding", ["投机解码", "推测解码", "投机采样"]],
  ["Chain-of-Thought", ["思维链"]],
  ["Hallucination", ["幻觉"]],
  ["Low-rank Compression", ["低秩压缩"]],
  ["low-rank factorization", ["低秩分解"]],
  ["Low Rank Adaptation", ["低秩适配"]],
  ["Feed-Forward Network", ["前馈网络"]],
  ["Rotary Position Embedding", ["旋转位置编码"]],
  ["Fill-in-Middle", ["中间填充"]],
  ["Model Architecture", ["模型架构"]],
  ["Error Analysis", ["错误分析"]],
  ["Data Labeling", ["数据标注"]],
  ["Feature Engineering", ["特征工程"]],
  ["Data Analysis", ["数据分析"]],
  ["Predictive Analytics", ["预测分析"]],
  ["Statistical Inference", ["统计推断"]],
  ["Deployment", ["部署"]]
];

const chineseAliasesByConceptKey = new Map<string, string[]>(
  chineseAliases.map(([concept, aliases]) => [normalizeConceptKey(concept), aliases])
);
