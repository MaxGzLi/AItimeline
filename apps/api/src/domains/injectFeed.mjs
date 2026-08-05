// @ts-check

// 注入面(浏览器插件)的取卡逻辑:从时间线排好序的结果里挑「该回来找用户」的卡。
// 复习到期的卡优先(它们正是设计上要送回用户眼前的),其余按时间线排名补位。
// 纯读:不写任何状态。

import { slugConcept } from "../../../../packages/core/dist/index.js";
import { getTimelineResponse } from "./responses.mjs";

const defaultInjectLimit = 3;
const maxInjectLimit = 10;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function parseInjectLimit(value) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;

  if (!Number.isInteger(parsed) || parsed < 1) {
    return defaultInjectLimit;
  }

  return Math.min(parsed, maxInjectLimit);
}

/**
 * 从已排序的时间线卡里选出可注入的前 N 张。
 * 连接播报卡是系统自己生成的评述,不是用户存下的知识,永远不注入;
 * 没有来源 URL 的卡也不注入(注入卡必须能指回出处)。
 *
 * @param {Array<Record<string, any>>} rankedPosts 时间线顺序的卡片
 * @param {number} limit
 * @returns {Array<Record<string, any>>}
 */
export function selectInjectableCards(rankedPosts, limit) {
  const eligible = rankedPosts.filter(
    (post) => post.kind !== "connection_note" && typeof post.sources?.[0]?.url === "string" && post.sources[0].url
  );

  return [...eligible.filter((post) => post.reviewDueAt), ...eligible.filter((post) => !post.reviewDueAt)].slice(
    0,
    limit
  );
}

/**
 * 只保留插件渲染和信号回传需要的字段。topicId 与网页端 getTopicId 的口径一致
 * (第一个概念的 slug,空则落回 general),这样注入面和网页面的信号会聚到同一个主题。
 *
 * @param {Record<string, any>} post
 */
export function toInjectCard(post) {
  const source = post.sources[0];

  return {
    id: post.id,
    title: post.title,
    summary: post.summary,
    sourceTitle: source.title,
    sourceUrl: source.url,
    savedAt: post.createdAt,
    topicId: slugConcept(post.concepts?.[0] ?? "") || "general",
    conceptIds: Array.isArray(post.concepts) ? post.concepts : [],
    ...(post.reviewDueAt ? { reviewDueAt: post.reviewDueAt } : {}),
    // 注入面要排出版面层次(眉题/导语/正文/边栏数据),光靠 title + summary 排不出来。
    // 全部可选:老的注入面读不到就当没有,不会因为某张卡缺字段而渲染失败。
    ...(post.hook ? { hook: post.hook } : {}),
    ...(post.keyTakeaway ? { keyTakeaway: post.keyTakeaway } : {}),
    ...(post.shortBody ? { shortBody: post.shortBody } : {}),
    ...(typeof post.estimatedReadMinutes === "number"
      ? { estimatedReadMinutes: post.estimatedReadMinutes }
      : {}),
    ...(post.difficulty ? { difficulty: post.difficulty } : {}),
    ...(post.trustState ? { trustState: post.trustState } : {}),
    ...(post.reviewPrompts?.[0]?.prompt ? { reviewPrompt: post.reviewPrompts[0].prompt } : {})
  };
}

/**
 * GET /api/inject/cards 的响应体。复用 getTimelineResponse 的排序与生命周期过滤,
 * 不传 curationStore(注入面用不到供给账单,少算一截)。
 *
 * @param {any} snapshot
 * @param {string | null} nowValue
 * @param {string} userId
 * @param {import("../../../../packages/core/dist/index.js").ContentLanguage} contentLanguage
 * @param {unknown} limitValue
 */
export function getInjectCardsResponse(snapshot, nowValue, userId, contentLanguage, limitValue) {
  const timeline = getTimelineResponse(snapshot, nowValue, userId, contentLanguage, undefined);

  return {
    cards: selectInjectableCards(timeline.posts, parseInjectLimit(limitValue)).map(toInjectCard)
  };
}
