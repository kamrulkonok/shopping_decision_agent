const {
  runReviewIntelligenceLLMAgent,
} = require("../agents/reviewIntelligenceLLMAgent");
const { runReliabilityScoringAgent } = require("../agents/reliabilityScoringAgent");
const { runQualityGuardAgent } = require("../agents/qualityGuardAgent");
const { runDecisionAgent } = require("../agents/decisionAgent");
const { runDecisionGuardAgent } = require("../agents/decisionGuardAgent");

function isDecisionLayerEnabled() {
  const raw = String(process.env.DECISION_LAYER_ENABLED || "true").toLowerCase();
  return raw !== "false";
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*Read more\s*$/i, "")
    .trim();
}

function normalizeReviewId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.replace(/^customer_review-/i, "").toLowerCase();
}

function preprocessReviews(rawReviews) {
  const inputReviews = Array.isArray(rawReviews) ? rawReviews : [];

  const usable = inputReviews
    .map((review) => ({
      ...review,
      review_title: normalizeText(review.review_title),
      review_text: normalizeText(review.review_text),
      review_id: normalizeReviewId(review.review_id),
    }))
    .filter((review) => {
      const hasAnyText = review.review_text.length > 0 || review.review_title.length > 0;
      const hasValidRating = Number.isFinite(Number(review.review_rating));
      return hasAnyText || hasValidRating;
    });

  const seen = new Set();
  const deduped = [];

  for (const review of usable) {
    if (review.review_id) {
      if (seen.has(review.review_id)) continue;
      seen.add(review.review_id);
    }
    deduped.push(review);
  }

  return {
    inputCount: inputReviews.length,
    usableCount: usable.length,
    dedupedCount: deduped.length,
    reviews: deduped,
  };
}

async function runReviewIntelligenceOrchestrator(productContext) {
  const preprocessed = preprocessReviews(productContext.reviews || []);

  const llmResult = await runReviewIntelligenceLLMAgent({
    productContext,
    reviews: preprocessed.reviews,
  });

  const scoreResult = runReliabilityScoringAgent({
    reviews: preprocessed.reviews,
    blockedByCaptcha: Boolean(productContext.blocked_by_captcha),
  });

  const reviewIntelligence = {
    ...llmResult,
    reliability_score: scoreResult.reliability_score,
    reliability_confidence: scoreResult.reliability_confidence,
    telemetry: {
      input_reviews: preprocessed.inputCount,
      usable_reviews: preprocessed.usableCount,
      deduped_reviews: preprocessed.dedupedCount,
      llm_used: Boolean(llmResult.llm_used),
      model: llmResult.llm_model || "fallback-heuristic",
      blocked_by_captcha: Boolean(productContext.blocked_by_captcha),
      multilingual_normalization_enabled: Boolean(
        llmResult?.normalization_telemetry?.multilingual_normalization_enabled
      ),
      translate_to_pivot_before_clustering: Boolean(
        llmResult?.normalization_telemetry?.translate_to_pivot_before_clustering
      ),
      pivot_language: llmResult?.normalization_telemetry?.pivot_language || "en",
      language_distribution: llmResult?.normalization_telemetry?.language_distribution || {},
      non_english_review_count: Number(
        llmResult?.normalization_telemetry?.non_english_review_count || 0
      ),
    },
  };

  const guardedReviewIntelligence = runQualityGuardAgent(reviewIntelligence);

  if (!isDecisionLayerEnabled()) {
    return {
      review_intelligence: guardedReviewIntelligence,
      decision: null,
      decision_unavailable: {
        code: "DECISION_LAYER_DISABLED",
        message: "Decision layer is disabled by configuration.",
      },
    };
  }

  try {
    const decisionStart = Date.now();
    const rawDecision = runDecisionAgent({
      productContext,
      reviewIntelligence: guardedReviewIntelligence,
    });
    const decision = runDecisionGuardAgent(rawDecision);
    const decisionLatency = Date.now() - decisionStart;

    return {
      review_intelligence: guardedReviewIntelligence,
      decision: {
        ...decision,
        telemetry: {
          decision_latency_ms: decisionLatency,
          decision_fallback_used: false,
        },
      },
      decision_unavailable: null,
    };
  } catch (error) {
    return {
      review_intelligence: guardedReviewIntelligence,
      decision: null,
      decision_unavailable: {
        code: "DECISION_AGENT_ERROR",
        message: error.message,
      },
    };
  }
}

module.exports = {
  runReviewIntelligenceOrchestrator,
};
