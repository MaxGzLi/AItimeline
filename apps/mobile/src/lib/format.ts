// 展示辅助函数。来源:apps/web/src/lib/format.ts —— 只搬手机端 v1 用到的纯函数,
// 逻辑与 web 端保持一致。
import type { KnowledgeCard } from "@aitimeline/core";

import type { SourceCandidateStatus } from "./types";

export function getAgentName(concept: string): string {
  if (concept === "RAG") return "RAG 实战笔记";
  if (concept === "智能体") return "智能体实验室";
  if (concept === "产品策略") return "产品闭环";
  if (concept === "知识图谱") return "图谱工作台";
  if (concept === "评估") return "评估台";

  return `${concept} 观察员`;
}

export function getAgentInitials(concept: string): string {
  return (
    concept
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AI"
  );
}

export function slugConcept(concept: string): string {
  // 保留 Unicode 字母/数字,让中文概念也能 slug 成一个稳定 key。
  return concept
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)/g, "");
}

export function getTopicId(card: KnowledgeCard): string {
  return slugConcept(card.concepts[0] ?? "general");
}

export function formatCandidateStatus(status: SourceCandidateStatus): string {
  const labels: Record<SourceCandidateStatus, string> = {
    pending: "待处理",
    queued: "已排队",
    imported: "已导入",
    dismissed: "已忽略"
  };

  return labels[status];
}

// 类微博的相对时间:"刚刚" / "5分钟" / "3小时" / "2天",更早的显示日期。
export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes}分钟`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}天`;
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" })
  }).format(date);
}

export function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}
