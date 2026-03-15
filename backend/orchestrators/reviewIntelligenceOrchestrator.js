const {
  runReviewIntelligenceLLMAgent,
} = require("../agents/reviewIntelligenceLLMAgent");
const { runReliabilityScoringAgent } = require("../agents/reliabilityScoringAgent");
const { runQualityGuardAgent } = require("../agents/qualityGuardAgent");

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*Read more\s*$/i, "")
    .trim();
}

function preprocessReviews(rawReviews) {
  const inputReviews = Array.isArray(rawReviews) ? rawReviews : [];

  const usable = inputReviews
    .map((review) => ({
      ...review,
      review_title: normalizeText(review.review_title),
      review_text: normalizeText(review.review_text),
    }))
    .filter((review) => review.review_text.length >= 10 || review.review_title.length >= 6);

  const seen = new Set();
  const deduped = [];

  for (const review of usable) {
    const key =
      review.review_id ||
      `${review.review_title}-${review.review_text}-${review.review_rating}-${review.review_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
    fakeReviewRisk: llmResult.fake_review_risk,
    blockedByCaptcha: Boolean(productContext.blocked_by_captcha),
  });

  const merged = {
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
    },
  };

  return runQualityGuardAgent(merged);
}

module.exports = {
  runReviewIntelligenceOrchestrator,
};
