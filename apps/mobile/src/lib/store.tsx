// 应用数据层:时间线帖子 + 本地互动信号,统一封装 API 调用。
// 时间线、详情、复习三个页面共享这里的状态;复习队列以服务端 /api/review/due 为真源。
import { type InteractionSignal, type KnowledgeCard } from "@aitimeline/core";
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

import { checkHealth, fetchReviewDue, fetchTimeline, postNote, postReply, postReviewComplete, postSignal } from "./api";
import { createInteractionSignal } from "./signals";
import { useSettings } from "./settings";
import type { ApiStatus, InteractionSignals, ReviewDueItem, ReviewGrade } from "./types";

interface StoreValue {
  status: ApiStatus;
  loading: boolean;
  error: string | null;
  posts: KnowledgeCard[];
  cardsById: Record<string, KnowledgeCard>;
  signalsByPost: InteractionSignals;
  reviewDue: ReviewDueItem[];
  refresh: () => Promise<void>;
  toggleLike: (card: KnowledgeCard) => void;
  toggleSave: (card: KnowledgeCard) => void;
  reply: (card: KnowledgeCard, text: string) => Promise<void>;
  addNote: (text: string) => Promise<KnowledgeCard>;
  completeReview: (postId: string, grade: ReviewGrade) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { apiBaseUrl, ready } = useSettings();
  const [status, setStatus] = useState<ApiStatus>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<KnowledgeCard[]>([]);
  const [signalsByPost, setSignalsByPost] = useState<InteractionSignals>({});
  const [reviewDue, setReviewDue] = useState<ReviewDueItem[]>([]);
  const baseUrlRef = useRef(apiBaseUrl);
  baseUrlRef.current = apiBaseUrl;
  // 与 signalsByPost 同步的镜像:applySignal 需要在 setState 之外同步拿到最新
  // 信号(React 不保证 updater 何时执行,不能靠 updater 里给外部变量赋值)。
  const signalsRef = useRef<InteractionSignals>({});

  useEffect(() => {
    signalsRef.current = signalsByPost;
  }, [signalsByPost]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus("checking");

    try {
      const timeline = await fetchTimeline(baseUrlRef.current);
      setPosts(timeline.posts);

      try {
        const due = await fetchReviewDue(baseUrlRef.current);
        setReviewDue(due.due);
      } catch {
        // 复习队列以服务端为真源;拿不到就先空着,时间线不受影响。
        setReviewDue([]);
      }

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
  // next 在 setState 之外用镜像 ref 同步算出:旧写法在 updater 里给外部变量
  // 赋值再立即读取,并发渲染下 updater 可能延后执行,信号根本发不出去。
  const applySignal = useCallback((card: KnowledgeCard, patch: Partial<InteractionSignal>) => {
    const base = signalsRef.current[card.id] ?? createInteractionSignal(card);
    const next: InteractionSignal = { ...base, ...patch, impression: true, createdAt: new Date().toISOString() };

    signalsRef.current = { ...signalsRef.current, [card.id]: next };
    setSignalsByPost(signalsRef.current);
    postSignal(baseUrlRef.current, next).catch(() => setStatus("offline"));
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

  // 完成一次复习:走服务端三档评分接口推进间隔;失败时抛出让复习页重试,
  // 不本地假报完成。复习事件以服务端为真源,这里不再另发 reviewed 信号(与 web 一致)。
  const completeReview = useCallback(
    async (postId: string, grade: ReviewGrade) => {
      await postReviewComplete(baseUrlRef.current, postId, grade, `${postId}-${Date.now()}`);
      setReviewDue((current) => current.filter((item) => item.postId !== postId));
    },
    []
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

  const value = useMemo<StoreValue>(
    () => ({
      status,
      loading,
      error,
      posts,
      cardsById,
      signalsByPost,
      reviewDue,
      refresh,
      toggleLike,
      toggleSave,
      reply,
      addNote,
      completeReview
    }),
    [
      status,
      loading,
      error,
      posts,
      cardsById,
      signalsByPost,
      reviewDue,
      refresh,
      toggleLike,
      toggleSave,
      reply,
      addNote,
      completeReview
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
