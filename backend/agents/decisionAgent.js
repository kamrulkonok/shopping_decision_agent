const DEFAULT_DECISION_ALGO_VERSION = process.env.DECISION_ALGO_VERSION || "decision-v1";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRisk(risk) {
  if (risk === "low" || risk === "medium" || risk === "high") return risk;
  return "unknown";
}

function getRiskBasePenalty(risk) {
  if (risk === "low") return 5;
  if (risk === "medium") return 15;
  if (risk === "high") return 30;
  return 12;
}

function runDecisionAgent({ productContext, reviewIntelligence }) {
  const avgRating = clamp((toNumber(productContext?.average_rating, 0) / 5) * 100);
  const totalRatings = Math.max(0, Math.round(toNumber(productContext?.total_ratings, 0)));
  const volumeScore = clamp((Math.log10(totalRatings + 1) / Math.log10(5001)) * 100);

  const featureCount = Array.isArray(productContext?.features) ? productContext.features.length : 0;
  const featureScore = clamp((featureCount / 12) * 100);

  const prosCount = Array.isArray(reviewIntelligence?.pros) ? reviewIntelligence.pros.length : 0;
  const consCount = Array.isArray(reviewIntelligence?.cons) ? reviewIntelligence.cons.length : 0;
  const prosConsScore =
    prosCount + consCount === 0 ? 50 : clamp((prosCount / (prosCount + consCount)) * 100);

  const clusters = Array.isArray(reviewIntelligence?.sentiment_clusters)
    ? reviewIntelligence.sentiment_clusters
    : [];
  let weightedSentiment = 0;
  let totalClusterCount = 0;
  let negativeClusterCount = 0;

  for (const cluster of clusters) {
    const count = Math.max(0, Math.round(toNumber(cluster?.count, 0)));
    totalClusterCount += count;
    const sentiment = String(cluster?.sentiment || "").toLowerCase();
    if (sentiment === "positive") {
      weightedSentiment += count;
    } else if (sentiment === "mixed") {
      weightedSentiment += count * 0.5;
    } else {
      negativeClusterCount += count;
    }
  }

  const sentimentScore =
    totalClusterCount > 0 ? clamp((weightedSentiment / totalClusterCount) * 100) : 50;

  const reliabilityScore = clamp(toNumber(reviewIntelligence?.reliability_score, 50));
  const reliabilityConfidence = Math.max(
    0,
    Math.min(1, toNumber(reviewIntelligence?.reliability_confidence, 0.25))
  );

  const telemetry = reviewIntelligence?.telemetry || {};
  const inputReviews = Math.max(0, Math.round(toNumber(telemetry.input_reviews, 0)));
  const usableReviews = Math.max(0, Math.round(toNumber(telemetry.usable_reviews, 0)));
  const dedupedReviews = Math.max(0, Math.round(toNumber(telemetry.deduped_reviews, 0)));
  const llmUsed = Boolean(telemetry.llm_used);
  const blockedByCaptcha = Boolean(telemetry.blocked_by_captcha);

  const usabilityRatio = inputReviews > 0 ? usableReviews / inputReviews : 0;
  const dedupeRetention = usableReviews > 0 ? dedupedReviews / usableReviews : 0;
  const sampleStrength = clamp((usableReviews / 60) * 100);

  const evidenceScore = clamp(
    0.45 * sampleStrength +
      0.25 * (usabilityRatio * 100) +
      0.2 * (dedupeRetention * 100) +
      0.1 * (llmUsed ? 100 : 70)
  );

  const price = Math.max(0, toNumber(productContext?.price, 0));
  const pricePressure = clamp((Math.log10(price + 1) / 3) * 100);
  const valueScore = clamp(
    0.55 * (0.6 * avgRating + 0.4 * sentimentScore) +
      0.25 * featureScore +
      0.2 * (100 - pricePressure)
  );

  const qualityScore = clamp(
    0.35 * avgRating + 0.2 * volumeScore + 0.25 * sentimentScore + 0.2 * prosConsScore
  );

  const risk = normalizeRisk(reviewIntelligence?.fake_review_risk);
  const negativeRatio = totalClusterCount > 0 ? negativeClusterCount / totalClusterCount : 0;
  const riskPenalty = clamp(
    getRiskBasePenalty(risk) +
      (consCount >= 5 ? 6 : 0) +
      (negativeRatio >= 0.35 ? 8 : 0) +
      (blockedByCaptcha ? 10 : 0)
  );

  const rawScore = clamp(
    0.35 * qualityScore + 0.25 * valueScore + 0.25 * reliabilityScore + 0.15 * evidenceScore
  );
  const decisionScore = clamp(rawScore - riskPenalty);

  const confidence = Math.max(
    0,
    Math.min(
      1,
      0.4 * reliabilityConfidence +
        0.35 * (evidenceScore / 100) +
        0.15 * (usableReviews >= 20 ? 1 : usableReviews / 20) +
        0.1 * (llmUsed ? 1 : 0.75) -
        (blockedByCaptcha ? 0.2 : 0)
    )
  );

  const decisionState = usableReviews < 8 || evidenceScore < 35 ? "insufficient_data" : "sufficient_data";

  let recommendation = "consider";
  if (
    decisionScore >= 72 &&
    confidence >= 0.55 &&
    risk !== "high" &&
    decisionState === "sufficient_data"
  ) {
    recommendation = "buy";
  } else if (decisionScore < 50 || risk === "high") {
    recommendation = "avoid";
  }

  if (recommendation === "buy" && confidence < 0.55) {
    recommendation = "consider";
  }

  const topReasons = [];
  if (avgRating >= 80) topReasons.push("Strong average rating signal.");
  if (reliabilityScore >= 70) topReasons.push("Review reliability appears good.");
  if (featureScore >= 60) topReasons.push("Feature set is relatively strong for category.");
  if (prosCount > consCount) topReasons.push("Pros materially outweigh cons in extracted reviews.");
  if (valueScore >= 65) topReasons.push("Value-for-money signal is positive.");

  const redFlags = [];
  if (risk === "high") redFlags.push("High fake/suspicious review risk signal.");
  if (blockedByCaptcha) redFlags.push("Review crawling encountered anti-bot/captcha friction.");
  if (consCount >= 5) redFlags.push("Cons volume is notable.");
  if (decisionState === "insufficient_data") redFlags.push("Not enough high-quality review evidence.");

  return {
    recommendation,
    decision_score: Math.round(decisionScore),
    confidence: Number(confidence.toFixed(2)),
    decision_state: decisionState,
    quality_score: Math.round(qualityScore),
    value_score: Math.round(valueScore),
    evidence_score: Math.round(evidenceScore),
    risk_penalty: Math.round(riskPenalty),
    top_reasons: topReasons.slice(0, 5),
    red_flags: redFlags.slice(0, 5),
    decision_algo_version: DEFAULT_DECISION_ALGO_VERSION,
  };
}

module.exports = {
  runDecisionAgent,
};
