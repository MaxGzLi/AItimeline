// 应用数据层:时间线帖子 + 本地互动信号,统一封装 API 调用和 core 复用
// (createReviewQueue)。时间线、详情、复习三个页面共享这里的状态。
import { createReviewQueue, type InteractionSignal, type KnowledgeCard, type ReviewItem } from "@aitimeline/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import { checkHealth, fetchTimeline, postNote, postReply, postSignal } from "./api";
import { createInteractionSignal, toReviewSignals } from "./signals";
import { useSettings } from "./settings";
import type { ApiStatus, InteractionSignals } from "./types";

interface StoreValue {
  status: ApiStatus;
  loading: boolean;
  error: string | null;
  posts: KnowledgeCard[];
  cardsById: Record<string, KnowledgeCard>;
  signalsByPost: InteractionSignals;
  reviewQueue: ReviewItem[];
  refresh: () => Promise<void>;
  toggleLike: (card: KnowledgeCard) => void;
  toggleSave: (card: KnowledgeCard) => void;
  reply: (card: KnowledgeCard, text: string) => Promise<void>;
  addNote: (text: string) => Promise<KnowledgeCard>;
  markReviewed: (card: KnowledgeCard) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { apiBaseUrl, ready } = useSettings();
  const [status, setStatus] = useState<ApiStatus>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<KnowledgeCard[]>([]);
  const [signalsByPost, setSignalsByPost] = useState<InteractionSignals>({});
  const baseUrlRef = useRef(apiBaseUrl);
  baseUrlRef.current = apiBaseUrl;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus("checking");

    try {
      const timeline = await fetchTimeline(baseUrlRef.current);
      setPosts(timeline.posts);
      setStatus("connected");
    } catch (err) {
      setStatus("offline");
      setError(err instanceof Error ? err.message : "无法连接到 API。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      void refresh();
    }
  }, [ready, apiBaseUrl, refresh]);

  // 本地更新一个帖子的信号,再同步给后端;失败时把状态标记为离线但不回滚
  // 本地乐观更新(与 web 端一致:交互先落地,信号异步同步)。
  const applySignal = useCallback((card: KnowledgeCard, patch: Partial<InteractionSignal>) => {
    let next: InteractionSignal | undefined;

    setSignalsByPost((current) => {
      const base = current[card.id] ?? createInteractionSignal(card);
      next = { ...base, ...patch, impression: true, createdAt: new Date().toISOString() };
      return { ...current, [card.id]: next };
    });

    if (next) {
      postSignal(baseUrlRef.current, next).catch(() => setStatus("offline"));
    }
  }, []);

  const toggleLike = useCallback(
    (card: KnowledgeCard) => {
      const current = signalsByPost[card.id];
      applySignal(card, { liked: !current?.liked });
    },
    [applySignal, signalsByPost]
  );

  const toggleSave = useCallback(
    (card: KnowledgeCard) => {
      const current = signalsByPost[card.id];
      applySignal(card, { saved: !current?.saved });
    },
    [applySignal, signalsByPost]
  );

  const markReviewed = useCallback(
    (card: KnowledgeCard) => {
      applySignal(card, { reviewed: true, skippedQuickly: false });
    },
    [applySignal]
  );

  const upsertPost = useCallback((post: KnowledgeCard) => {
    setPosts((current) => {
      const rest = current.filter((item) => item.id !== post.id);
      return [post, ...rest];
    });
  }, []);

  const reply = useCallback(
    async (card: KnowledgeCard, text: string) => {
      const result = await postReply(baseUrlRef.current, card.id, text);
      setPosts((current) => current.map((item) => (item.id === result.post.id ? result.post : item)));
      applySignal(card, { openedThread: true, askedQuestion: true });
    },
    [applySignal]
  );

  const addNote = useCallback(
    async (text: string) => {
      const result = await postNote(baseUrlRef.current, text);
      upsertPost(result.post);
      return result.post;
    },
    [upsertPost]
  );

  const cardsById = useMemo(() => {
    const byId: Record<string, KnowledgeCard> = {};
    for (const card of posts) {
      byId[card.id] = card;
    }
    return byId;
  }, [posts]);

  const reviewQueue = useMemo(
    () => createReviewQueue(posts, toReviewSignals(signalsByPost)),
    [posts, signalsByPost]
  );

  const value = useMemo<StoreValue>(
    () => ({
      status,
      loading,
      error,
      posts,
      cardsById,
      signalsByPost,
      reviewQueue,
      refresh,
      toggleLike,
      toggleSave,
      reply,
      addNote,
      markReviewed
    }),
    [
      status,
      loading,
      error,
      posts,
      cardsById,
      signalsByPost,
      reviewQueue,
      refresh,
      toggleLike,
      toggleSave,
      reply,
      addNote,
      markReviewed
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);

  if (!value) {
    throw new Error("useStore 必须在 StoreProvider 内使用。");
  }

  return value;
}

export function useHealthProbe() {
  const { apiBaseUrl } = useSettings();
  const [state, setState] = useState<ApiStatus>("checking");

  const probe = useCallback(async () => {
    setState("checking");
    const ok = await checkHealth(apiBaseUrl);
    setState(ok ? "connected" : "offline");
  }, [apiBaseUrl]);

  useEffect(() => {
    void probe();
  }, [probe]);

  return { state, probe };
}
