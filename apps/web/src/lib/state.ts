import type { InteractionSignal, KnowledgeCard, RankedKnowledgeCard, SourceImport, TopicState } from "@aitimeline/core";
import { getTopicId } from "./format";
import { t } from "./i18n";
import type { PersistedMvpState } from "./types";

const storageKey = "aitimeline.mvp.v3";
const syncedSignalsStorageKey = "aitimeline.synced-signals.v1";

export function mergeCards(newCards: KnowledgeCard[], currentCards: KnowledgeCard[]): KnowledgeCard[] {
  const newCardIds = new Set(newCards.map((card) => card.id));
  return [...newCards, ...currentCards.filter((card) => !newCardIds.has(card.id))];
}

export function ensureRankedCards(cards: KnowledgeCard[]): RankedKnowledgeCard[] {
  return cards.map((card) => {
    if (isRankedKnowledgeCard(card)) {
      return card;
    }

    return {
      ...card,
      score: 0,
      scoreReasons: [card.recommendedBecause || t("state.scoreReason.default")]
    };
  });
}

export function isRankedKnowledgeCard(card: KnowledgeCard): card is RankedKnowledgeCard {
  const maybeRanked = card as Partial<RankedKnowledgeCard>;

  return typeof maybeRanked.score === "number" && Array.isArray(maybeRanked.scoreReasons);
}

export function upsertById<T extends { id: string }>(currentItems: T[], newItems: T[]): T[] {
  const newItemIds = new Set(newItems.map((item) => item.id));
  return [...newItems, ...currentItems.filter((item) => !newItemIds.has(item.id))];
}

export function upsertImport(imports: SourceImport[], nextImport: SourceImport): SourceImport[] {
  return [nextImport, ...imports.filter((item) => item.id !== nextImport.id)];
}

export function createInteractionSignal(card: KnowledgeCard): InteractionSignal {
  return {
    postId: card.id,
    topicId: getTopicId(card),
    conceptIds: card.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: new Date().toISOString()
  };
}

export function deriveTopicState(signal: InteractionSignal): TopicState {
  const positiveSignals = [signal.openedThread, signal.liked, signal.saved, signal.askedQuestion, signal.reviewed].filter(
    Boolean
  ).length;

  return {
    topicId: signal.topicId,
    interestScore: Math.min(1, positiveSignals / 4),
    fatigueScore: signal.skippedQuickly ? 0.85 : 0.15,
    comprehensionScore: signal.askedQuestion ? 0.35 : signal.reviewed || signal.saved ? 0.78 : 0.55
  };
}

export function shouldSyncSignal(signal: InteractionSignal): boolean {
  return (
    signal.impression &&
    (signal.dwellTimeMs > 0 ||
      signal.openedThread ||
      signal.liked ||
      signal.saved ||
      signal.askedQuestion ||
      signal.reviewed ||
      signal.skippedQuickly)
  );
}

export function createSignalSignature(signal: InteractionSignal): string {
  return [
    signal.postId,
    signal.topicId,
    Math.round(signal.dwellTimeMs / 1000),
    signal.openedThread,
    signal.liked,
    signal.saved,
    signal.askedQuestion,
    signal.reviewed,
    signal.skippedQuickly
  ].join(":");
}

export function loadStoredState(): PersistedMvpState | null {
  try {
    const rawState = window.localStorage.getItem(storageKey);
    return rawState ? (JSON.parse(rawState) as PersistedMvpState) : null;
  } catch {
    return null;
  }
}

export function saveStoredState(state: PersistedMvpState): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist timeline state to local storage.", error);
  }
}

export function loadSyncedSignalSignatures(): Record<string, string> {
  try {
    const rawState = window.localStorage.getItem(syncedSignalsStorageKey);
    const parsed = rawState ? (JSON.parse(rawState) as unknown) : {};

    return isStringRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSyncedSignalSignatures(signatures: Record<string, string>): void {
  try {
    window.localStorage.setItem(syncedSignalsStorageKey, JSON.stringify(signatures));
  } catch (error) {
    console.warn("Failed to persist synced signal signatures to local storage.", error);
  }
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
