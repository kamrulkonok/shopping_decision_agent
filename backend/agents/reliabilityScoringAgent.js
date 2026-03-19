function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function runReliabilityScoringAgent({ reviews, blockedByCaptcha }) {
  const total = Array.isArray(reviews) ? reviews.length : 0;
  const verifiedCount = (reviews || []).filter((review) => review.verified_purchase).length;
  const verifiedRatio = total > 0 ? verifiedCount / total : 0;

  const avgRating =
    total > 0
      ? (reviews || []).reduce((sum, review) => sum + Number(review.review_rating || 0), 0) / total
      : 0;

  const highRatingRatio =
    total > 0
      ? (reviews || []).filter((review) => Number(review.review_rating || 0) >= 4).length / total
      : 0;

  const consistencyPenalty = Math.abs(avgRating / 5 - highRatingRatio) * 20;
  const sampleScore = clamp((total / 80) * 40, 0, 40);
  const verifiedScore = clamp(verifiedRatio * 25, 0, 25);
  const baseScore = 30 + sampleScore + verifiedScore - consistencyPenalty;

  const captchaPenalty = blockedByCaptcha ? 10 : 0;

  const score = clamp(Math.round(baseScore - captchaPenalty), 0, 100);

  const confidenceBase = clamp(total / 60, 0, 1);
  const confidence = clamp(Number(confidenceBase.toFixed(2)), 0, 1);

  return {
    reliability_score: score,
    reliability_confidence: confidence,
    score_details: {
      total_reviews: total,
      verified_ratio: Number(verifiedRatio.toFixed(3)),
      avg_rating: Number(avgRating.toFixed(2)),
      captcha_penalty: captchaPenalty,
    },
  };
}

module.exports = {
  runReliabilityScoringAgent,
};
