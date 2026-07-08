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

export const DEEP_READ_WRITING_REQUIREMENTS = [
  "这是给人读的文章正文,不是要点列表、不是表格填空、不是几字一句的提纲。",
  "每章写 5-8 段;每段 3-6 句,约 150-350 字。",
  "章首用一个具体例子、冲突或问题进入,不要先下抽象定义。",
  "段与段之间要承接:上一段结尾自然引出下一段,不要孤立罗列。",
  "章尾用一句话接回全文主线,说明本章怎样帮助读者理解主题。",
  "不得重复已写章节讲过的概念解释或例子;需要时用一句话回指前文,然后只写新内容。",
  "整篇用目标语言写作;术语可保留英文,但不得整段照抄英文原文,引用内容要用自己的话转述。",
  "涉及数字、日期、版本号的句子必须标为 fact 并挂引用;综合段里出现的数字同样必须能在所引原文里找到。"
] as const;

export const DEEP_READ_MODEL_PARAGRAPH_COUNT_RANGE = {
  min: 5,
  max: 8
} as const;

export const DEEP_READ_MODEL_SENTENCE_COUNT_RANGE = {
  min: 3,
  max: 6
} as const;

export const DEEP_READ_MODEL_PARAGRAPH_LENGTH_RANGE = {
  min: 150,
  max: 350
} as const;

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
  "总而言之",
  "总结来说",
  "综上所述",
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
