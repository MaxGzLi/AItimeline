// @ts-check

import {
  coalesceInteractionSignals,
  evaluateInteraction,
  getDayKey,
  isPureExposureSignal
} from "../../../../packages/core/dist/index.js";
import { roundScore } from "./shared.mjs";

export function findCoalescedDailySignal(records, targetSignal) {
  const targetDayKey = getDayKey(targetSignal.createdAt);

  return coalesceInteractionSignals(records).find(
    (signal) =>
      !isPureExposureSignal(signal) &&
      signal.postId === targetSignal.postId &&
      getDayKey(signal.createdAt) === targetDayKey
  );
}

const coalescedActionFields = ["openedThread", "liked", "saved", "askedQuestion", "reviewed", "skippedQuickly"];

export function shouldEnqueueCoalescedProduction(previousSignal, nextSignal) {
  if (!previousSignal) {
    return true;
  }

  if (getNewCoalescedActionFields(previousSignal, nextSignal).length > 0) {
    return true;
  }

  return !isProductionQualifiedSignal(previousSignal) && isProductionQualifiedSignal(nextSignal);
}

export function updateTopicStateFromCoalescedDelta({
  currentTopicState,
  observedTopicState,
  previousSignal,
  nextSignal,
  updatedAt
}) {
  if (!currentTopicState || !previousSignal) {
    const feedback = evaluateInteraction(nextSignal, observedTopicState);

    return {
      changed: true,
      topicState: updateTopicStateFromFeedback(
        currentTopicState,
        observedTopicState,
        nextSignal,
        feedback,
        updatedAt
      )
    };
  }

  let topicState = currentTopicState;
  let changed = false;
  const newActionFields = getNewCoalescedActionFields(previousSignal, nextSignal);

  if (newActionFields.length > 0) {
    const actionSignal = {
      ...nextSignal,
      impression: false,
      dwellTimeMs: 0
    };

    for (const field of coalescedActionFields) {
      actionSignal[field] = newActionFields.includes(field);
    }

    const actionFeedback = evaluateInteraction(actionSignal, observedTopicState);
    topicState = updateTopicStateFromFeedback(
      topicState,
      observedTopicState,
      actionSignal,
      actionFeedback,
      updatedAt
    );
    changed = true;
  }

  const previousDwellOnCurrentActions = {
    ...nextSignal,
    dwellTimeMs: previousSignal.dwellTimeMs
  };
  const previousDwellFeedback = evaluateInteraction(previousDwellOnCurrentActions, observedTopicState);
  const nextDwellFeedback = evaluateInteraction(nextSignal, observedTopicState);
  const previousReadBonus = previousSignal.dwellTimeMs >= 12000 ? 0.08 : 0;
  const nextReadBonus = nextSignal.dwellTimeMs >= 12000 ? 0.08 : 0;
  let interestDelta = nextReadBonus - previousReadBonus;
  let fatigueDelta = 0;

  if (
    previousDwellFeedback.inferredState === "interested" &&
    nextDwellFeedback.inferredState === "interested"
  ) {
    interestDelta +=
      getInterestedStrengthContribution(nextDwellFeedback) -
      getInterestedStrengthContribution(previousDwellFeedback);
  }

  if (
    previousDwellFeedback.inferredState === "not_relevant" &&
    nextDwellFeedback.inferredState === "not_relevant"
  ) {
    const previousPenalty = previousSignal.dwellTimeMs < 2500 ? 0.16 : 0.06;
    const nextPenalty = nextSignal.dwellTimeMs < 2500 ? 0.16 : 0.06;
    fatigueDelta = nextPenalty - previousPenalty;
  }

  if (interestDelta !== 0 || fatigueDelta !== 0) {
    topicState = {
      ...topicState,
      interestScore: roundScore(clampScore(topicState.interestScore + interestDelta)),
      fatigueScore: roundScore(clampScore(topicState.fatigueScore + fatigueDelta)),
      updatedAt: new Date(updatedAt).toISOString()
    };
    changed = true;
  }

  return { changed, topicState };
}

function getNewCoalescedActionFields(previousSignal, nextSignal) {
  return coalescedActionFields.filter((field) => nextSignal[field] && !previousSignal[field]);
}

function isProductionQualifiedSignal(signal) {
  return signal.dwellTimeMs >= 9000 || coalescedActionFields.some((field) => signal[field]);
}

function updateTopicStateFromFeedback(currentState, observedState, signal, feedback, nowValue) {
  const now = new Date(nowValue);
  let interestScore = blendScores(currentState?.interestScore, observedState.interestScore, 0.45);
  let fatigueScore = blendScores(currentState?.fatigueScore, observedState.fatigueScore, 0.55);
  let comprehensionScore = blendScores(currentState?.comprehensionScore, observedState.comprehensionScore, 0.35);

  if (feedback.inferredState === "interested") {
    interestScore += 0.12 + getInterestedStrengthContribution(feedback);
    fatigueScore *= 0.55;
  }

  if (feedback.inferredState === "confused") {
    interestScore += 0.08;
    comprehensionScore -= 0.16;
    fatigueScore *= 0.7;
  }

  if (feedback.inferredState === "needs_review") {
    interestScore += 0.1;
    comprehensionScore += 0.08;
    fatigueScore *= 0.7;
  }

  if (feedback.inferredState === "fatigued") {
    interestScore *= 0.82;
    fatigueScore += 0.28;
  }

  if (feedback.inferredState === "not_relevant") {
    interestScore *= 0.88;
    fatigueScore += signal.dwellTimeMs < 2500 ? 0.16 : 0.06;
  }

  if (signal.dwellTimeMs >= 12000) {
    interestScore += 0.08;
  }

  if (signal.liked || signal.saved) {
    interestScore += 0.08;
  }

  if (signal.reviewed) {
    comprehensionScore += 0.08;
  }

  let cooldownUntil = currentState?.cooldownUntil;

  if (feedback.nextAction === "cooldown_topic") {
    cooldownUntil = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
  } else if (cooldownUntil && new Date(cooldownUntil) <= now) {
    cooldownUntil = undefined;
  }

  return {
    topicId: observedState.topicId,
    interestScore: roundScore(clampScore(interestScore)),
    fatigueScore: roundScore(clampScore(fatigueScore)),
    comprehensionScore: roundScore(clampScore(comprehensionScore)),
    cooldownUntil,
    updatedAt: now.toISOString()
  };
}

function getInterestedStrengthContribution(feedback) {
  const strength = Math.max(0, Math.min(20, feedback.signalStrength)) / 20;

  // Topic scores are persisted at two decimals. Quantize this replaceable
  // component at the same boundary so cumulative dwell updates converge with
  // a single report containing the final daily max.
  return roundScore(strength * 0.18);
}

function blendScores(currentValue, observedValue, observedWeight) {
  if (typeof currentValue !== "number") {
    return observedValue;
  }

  return currentValue * (1 - observedWeight) + observedValue * observedWeight;
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}
