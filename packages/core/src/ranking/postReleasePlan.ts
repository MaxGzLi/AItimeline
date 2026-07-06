import type { KnowledgePost } from "../types.js";

export type SourcePostReleaseStatus = "ready_now" | "queued" | "suppressed";

export interface SourcePostReleasePolicy {
  maxImmediatePostsPerSource: number;
  maxQueuedPostsPerSource: number;
  minutesBetweenQueuedPosts: number;
}

export interface SourcePostReleaseItem {
  postId: string;
  sourceId: string;
  status: SourcePostReleaseStatus;
  releaseAt?: string;
  priority: number;
  reason: string;
  conceptIds: string[];
}

export interface SourcePostReleasePlan {
  generatedAt: string;
  policy: SourcePostReleasePolicy;
  items: SourcePostReleaseItem[];
  immediatePostIds: string[];
  queuedPostIds: string[];
  suppressedPostIds: string[];
}

export interface CreateSourcePostReleasePlanInput {
  posts: KnowledgePost[];
  generatedAt?: string | Date;
  policy?: Partial<SourcePostReleasePolicy>;
}

export const defaultSourcePostReleasePolicy: SourcePostReleasePolicy = {
  // 与 maxPostsPerRun(4)对齐:论文板块卡固定 3-4 张,须一次性进时间线(spec:不做分批释放)。
  maxImmediatePostsPerSource: 4,
  maxQueuedPostsPerSource: 12,
  minutesBetweenQueuedPosts: 90
};

export function createSourcePostReleasePlan(input: CreateSourcePostReleasePlanInput): SourcePostReleasePlan {
  const generatedAt = normalizeDate(input.generatedAt);
  const policy = { ...defaultSourcePostReleasePolicy, ...input.policy };
  const postsBySourceId = groupPostsBySourceId(input.posts);
  const items = Array.from(postsBySourceId.entries()).flatMap(([sourceId, posts]) =>
    createReleaseItemsForSource(sourceId, posts, generatedAt, policy)
  );

  return {
    generatedAt: generatedAt.toISOString(),
    policy,
    items,
    immediatePostIds: items.filter((item) => item.status === "ready_now").map((item) => item.postId),
    queuedPostIds: items.filter((item) => item.status === "queued").map((item) => item.postId),
    suppressedPostIds: items.filter((item) => item.status === "suppressed").map((item) => item.postId)
  };
}

function createReleaseItemsForSource(
  sourceId: string,
  posts: KnowledgePost[],
  generatedAt: Date,
  policy: SourcePostReleasePolicy
): SourcePostReleaseItem[] {
  const orderedPosts = orderPostsForRelease(posts);

  return orderedPosts.map((post, index) => {
    const priority = scorePostReleasePriority(post, index);
    const conceptIds = post.concepts;

    if (index < policy.maxImmediatePostsPerSource) {
      return {
        postId: post.id,
        sourceId,
        status: "ready_now",
        releaseAt: generatedAt.toISOString(),
        priority,
        conceptIds,
        reason: "Allow the strongest first posts from this source into the timeline now."
      };
    }

    const queuedIndex = index - policy.maxImmediatePostsPerSource;

    if (queuedIndex < policy.maxQueuedPostsPerSource) {
      return {
        postId: post.id,
        sourceId,
        status: "queued",
        releaseAt: addMinutes(generatedAt, policy.minutesBetweenQueuedPosts * (queuedIndex + 1)).toISOString(),
        priority,
        conceptIds,
        reason: "Queue this post so one long source does not flood the timeline."
      };
    }

    return {
      postId: post.id,
      sourceId,
      status: "suppressed",
      priority,
      conceptIds,
      reason: "Suppress this post because the source already generated enough queued material."
    };
  });
}

function orderPostsForRelease(posts: KnowledgePost[]): KnowledgePost[] {
  return [...posts].sort((left, right) => scorePostReleasePriority(right, 0) - scorePostReleasePriority(left, 0));
}

function scorePostReleasePriority(post: KnowledgePost, index: number): number {
  let priority = 0.45;

  if (post.confidence === "high") priority += 0.12;
  if (post.confidence === "medium") priority += 0.06;
  if (post.difficulty === "beginner") priority += 0.08;
  if (post.difficulty === "intermediate") priority += 0.04;
  if (post.nextActions.includes("continue_deeper")) priority += 0.06;
  if (post.nextActions.includes("expand_broader")) priority += 0.05;
  if (post.reviewPrompts.length > 0) priority += 0.04;
  if (post.graphEdges.length > 0) priority += 0.04;
  priority -= Math.min(index, 20) * 0.01;

  return Math.round(Math.max(0.05, Math.min(priority, 1)) * 100) / 100;
}

function groupPostsBySourceId(posts: KnowledgePost[]): Map<string, KnowledgePost[]> {
  const postsBySourceId = new Map<string, KnowledgePost[]>();

  for (const post of posts) {
    const sourceId = post.sources[0]?.id ?? "unknown-source";
    const sourcePosts = postsBySourceId.get(sourceId) ?? [];

    sourcePosts.push(post);
    postsBySourceId.set(sourceId, sourcePosts);
  }

  return postsBySourceId;
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function addMinutes(date: Date, minutes: number): Date {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}
