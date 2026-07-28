// @ts-check

import { randomUUID } from "node:crypto";
import {
  applyUserMemoryEdits,
  createEmptyUserMemory,
  evaluateInteraction,
  mergeSourceRegistries,
  runConversationTurn,
  runIdeaObservation,
  transformUserNote
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  buildInteractionSignalRecordId,
  deriveTopicState,
  hashText,
  summarizeSnapshot,
  toUserSignals
} from "./shared.mjs";
import { getKnowledgePosts } from "./importSettlement.mjs";
import { cloneAnswerCitations, executeDiscoveryAction } from "./research.mjs";

// A user note becomes a first-class post (self-grounded source) and the
// observer replies against the existing library, metered as an agent turn.
export async function handleUserNote(body, userId, persistenceStore, client, searchProvider, contentLanguage) {
  if (body.kind === "idea") {
    return handleUserIdeaNote(body, userId, persistenceStore, client, contentLanguage);
  }

  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const libraryPosts = getKnowledgePosts(snapshot.posts);
  const libraryConcepts = Array.from(new Set(libraryPosts.flatMap((post) => post.concepts)));
  const note = transformUserNote(body.text, { createdAt: now, libraryConcepts, contentLanguage });

  // Reply from the pre-note library only, so the observer grounds its answer
  // in imported sources instead of echoing the note back.
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const turn = await runConversationTurn(
    {
      question: note.post.summary,
      posts: libraryPosts,
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      now
    },
    { client, contentLanguage }
  );

  // Persist the observer's reply on the note itself so the thread survives reloads.
  const replyBody = turn.answer ? turn.answer.answer : turn.notes.join(" ");
  const replySourceTitle = turn.answer?.citations?.[0]?.sourceTitle;
  const notePost = {
    ...note.post,
    thread: replyBody
      ? [
          {
            id: `${note.post.id}-agent-reply-1`,
            kind: "agent_reply",
            title:
              contentLanguage === "en"
                ? replySourceTitle
                  ? `Knowledge Observer · Source: ${replySourceTitle}`
                  : "Knowledge Observer"
                : replySourceTitle
                  ? `知识观察员 · 来源:${replySourceTitle}`
                  : "知识观察员",
            body: replyBody,
            citations: cloneAnswerCitations(turn.answer),
            grounded: turn.answer?.grounded ?? false,
            ...(turn.answer?.runnerKind ? { runnerKind: turn.answer.runnerKind } : {})
          }
        ]
      : []
  };

  persistenceStore.saveSourceImportResult(
    {
      importRecord: note.importRecord,
      source: note.source,
      assets: [note.asset],
      chunks: note.chunks,
      sourceRegistry: note.sourceRegistry,
      posts: [notePost]
    },
    now
  );

  const discoveredCandidates = await executeDiscoveryAction(
    turn,
    snapshot,
    memory,
    searchProvider,
    persistenceStore,
    now,
    contentLanguage
  );

  if (turn.signal) {
    persistenceStore.saveInteractionSignalRecords(
      [
        {
          id: buildInteractionSignalRecordId(turn.signal),
          signal: turn.signal,
          feedback: evaluateInteraction(turn.signal, deriveTopicState(turn.signal)),
          createdAt: now
        }
      ],
      now
    );
  }

  const memoryEditResult = applyUserMemoryEdits(
    memory ?? createEmptyUserMemory(),
    [
      {
        kind: "add",
        field: "interaction.recentQuestions",
        value: turn.question,
        reason: "User posted a note to the timeline."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|note|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: "answered",
    threadId: `agent-thread-note-${note.post.id}`,
    answerCardId: turn.answerCardId,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    post: notePost,
    turn,
    turnRecord,
    discoveredCandidates,
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

async function handleUserIdeaNote(body, userId, persistenceStore, client, contentLanguage) {
  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const libraryPosts = getKnowledgePosts(snapshot.posts);
  const libraryConcepts = Array.from(new Set(libraryPosts.flatMap((post) => post.concepts)));
  const note = transformUserNote(body.text, {
    createdAt: now,
    kind: "idea",
    libraryConcepts,
    libraryCards: libraryPosts,
    conceptAliases: snapshot.conceptAliases,
    contentLanguage
  });
  const turn = await runIdeaObservation(
    {
      idea: body.text,
      posts: libraryPosts,
      conceptAliases: snapshot.conceptAliases,
      now
    },
    { client, contentLanguage }
  );
  const replyBody = turn.notes.join("\n\n");
  const notePost = {
    ...note.post,
    thread: replyBody
      ? [
          {
            id: `${note.post.id}-agent-reply-1`,
            kind: "agent_reply",
            title: contentLanguage === "en" ? "Knowledge Observer" : "知识观察员",
            body: replyBody,
            citations: [],
            grounded: false
          }
        ]
      : []
  };

  persistenceStore.saveSourceImportResult(
    {
      importRecord: note.importRecord,
      source: note.source,
      assets: [note.asset],
      chunks: note.chunks,
      sourceRegistry: note.sourceRegistry,
      posts: [notePost]
    },
    now
  );

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|idea|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: "answered",
    threadId: `agent-thread-idea-${note.post.id}`,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    post: notePost,
    turn,
    turnRecord,
    discoveredCandidates: [],
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

// A comment on a knowledge card becomes a public in-post thread: the user's
// comment and the observer's grounded reply are both appended to the card's
// thread and persisted, and the reply is metered as an agent turn.
export async function handlePostReply(postId, body, userId, persistenceStore, client, searchProvider, contentLanguage) {
  const snapshot = persistenceStore.getSnapshot();
  const post = snapshot.posts.find((candidate) => candidate.id === postId);

  if (!post) {
    throw new HttpError(404, `No post found for id ${postId}.`);
  }

  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const commentText = body.text.trim();

  // Ground the reply against this specific card, so the observer answers from
  // the card's own sources instead of routing by concept overlap.
  const turn = await runConversationTurn(
    {
      question: commentText,
      postId,
      posts: getKnowledgePosts(snapshot.posts),
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      now
    },
    { client, contentLanguage }
  );

  const replyBody = turn.answer ? turn.answer.answer : turn.notes.join(" ");
  const replySourceTitle = turn.answer?.citations?.[0]?.sourceTitle;
  const commentBlock = {
    id: `${post.id}-user-comment-${randomUUID()}`,
    kind: "user_comment",
    title: contentLanguage === "en" ? "You" : "你",
    body: commentText
  };
  const replyBlock = replyBody
    ? {
        id: `${post.id}-agent-reply-${randomUUID()}`,
        kind: "agent_reply",
        title:
          contentLanguage === "en"
            ? replySourceTitle
              ? `Knowledge Observer · Source: ${replySourceTitle}`
              : "Knowledge Observer"
            : replySourceTitle
              ? `知识观察员 · 来源:${replySourceTitle}`
              : "知识观察员",
        body: replyBody,
        citations: cloneAnswerCitations(turn.answer),
        grounded: turn.answer?.grounded ?? false,
        ...(turn.answer?.runnerKind ? { runnerKind: turn.answer.runnerKind } : {})
      }
    : null;
  const appendedSnapshot = persistenceStore.appendThreadBlocks(
    postId,
    [commentBlock, ...(replyBlock ? [replyBlock] : [])],
    { expectedRevision: snapshot.revision, savedAt: now }
  );
  const appendedPost = appendedSnapshot.posts.find((candidate) => candidate.id === postId);

  const discoveredCandidates = await executeDiscoveryAction(
    turn,
    snapshot,
    memory,
    searchProvider,
    persistenceStore,
    now,
    contentLanguage
  );

  if (turn.signal) {
    persistenceStore.saveInteractionSignalRecords(
      [
        {
          id: buildInteractionSignalRecordId(turn.signal),
          signal: turn.signal,
          feedback: evaluateInteraction(turn.signal, deriveTopicState(turn.signal)),
          createdAt: now
        }
      ],
      now
    );
  }

  const latestMemory = persistenceStore
    .getSnapshot()
    .userMemories.find((record) => record.userId === userId)?.memory;
  const memoryEditResult = applyUserMemoryEdits(
    latestMemory ?? createEmptyUserMemory(),
    [
      {
        kind: "add",
        field: "interaction.recentQuestions",
        value: turn.question,
        reason: "User commented on a knowledge card."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|reply|${postId}|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: "answered",
    threadId: `agent-thread-post-${postId}`,
    answerCardId: turn.answerCardId,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    post: appendedPost,
    turn,
    turnRecord,
    discoveredCandidates,
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}
