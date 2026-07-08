export const deepReadPipelineVersion = "deep-read-article-v0" as const;

export const DEEP_READ_STRUCTURE_RULES = [
  "开头=用已掌握概念搭桥+造问题(SCQA)。",
  "具体先于抽象、例子先于定义。",
  "每段最多一个新概念、按依赖排序、章尾接回主线。",
  "是什么必配为什么+取舍。",
  "事实断言挂来源、观点与事实可区分。",
  "来源里的限定语不许丢:相关性不写成因果,相对数字配绝对数字。",
  "类比短且标边界。",
  "结尾=可复述的收获+明说没覆盖什么。"
] as const;

export const DEEP_READ_ANTI_SLOP_RULES = [
  "禁用空泛转折:值得注意的是、不可否认的是、总的来说、换句话说、从某种意义上说。",
  "禁用否定对仗模板:不是 X 而是 Y、既不是 X 也不是 Y 而是 Z。",
  "禁用三连排比和口号式总结。",
  "禁用只有态度、没有事实增量的总结段。",
  "禁用加粗小标题列表腔。"
] as const;

export const DEEP_READ_BANNED_PHRASES = [
  "值得注意的是",
  "不可否认的是",
  "总的来说",
  "换句话说",
  "从某种意义上说",
  "notably",
  "it is worth noting",
  "in conclusion",
  "in summary",
  "overall"
] as const;

export const DEEP_READ_GENERIC_OPENERS = [
  "本文将",
  "本章将",
  "接下来我们",
  "让我们",
  "this article will",
  "this chapter will",
  "let us",
  "let's"
] as const;
