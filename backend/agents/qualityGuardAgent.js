function asTrimmedString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeRisk(value) {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "unknown";
}

function sanitizeList(items, maxLength = 6) {
  if (!Array.isArray(items)) return [];
  const unique = [];
  const seen = new Set();

  for (const item of items) {
    const normalized = asTrimmedString(item);
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    unique.push(normalized);
    if (unique.length >= maxLength) break;
  }

  return unique;
}

function sanitizeClusters(clusters) {
  if (!Array.isArray(clusters)) return [];

  return clusters
    .map((cluster) => {
      const theme = asTrimmedString(cluster?.theme);
      const sentiment = asTrimmedString(cluster?.sentiment).toLowerCase();
      const count = Number.isFinite(Number(cluster?.count))
        ? Math.max(0, Math.round(Number(cluster.count)))
        : 0;

      if (!theme) return null;

      return {
        theme,
        sentiment:
          sentiment === "positive" || sentiment === "negative" || sentiment === "mixed"
            ? sentiment
            : "mixed",
        count,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function runQualityGuardAgent(payload) {
  const guarded = {
    reliability_score: Math.max(0, Math.min(100, Number(payload?.reliability_score ?? 0))),
    reliability_confidence: Math.max(
      0,
      Math.min(1, Number(payload?.reliability_confidence ?? 0.2))
    ),
    fake_review_risk: normalizeRisk(payload?.fake_review_risk),
    fake_review_risk_reasons: sanitizeList(payload?.fake_review_risk_reasons, 5),
    pros: sanitizeList(payload?.pros, 6),
    cons: sanitizeList(payload?.cons, 6),
    sentiment_clusters: sanitizeClusters(payload?.sentiment_clusters),
    review_summary: asTrimmedString(
      payload?.review_summary,
      "Review analysis completed with limited confidence due to sparse or noisy signals."
    ),
    telemetry: {
      input_reviews: Math.max(0, Math.round(Number(payload?.telemetry?.input_reviews ?? 0))),
      usable_reviews: Math.max(0, Math.round(Number(payload?.telemetry?.usable_reviews ?? 0))),
      deduped_reviews: Math.max(0, Math.round(Number(payload?.telemetry?.deduped_reviews ?? 0))),
      llm_used: Boolean(payload?.telemetry?.llm_used),
      model: asTrimmedString(payload?.telemetry?.model, "none"),
      blocked_by_captcha: Boolean(payload?.telemetry?.blocked_by_captcha),
    },
  };

  if (guarded.pros.length === 0) {
    guarded.pros = ["Insufficient clear positive themes from current review sample."];
  }

  if (guarded.cons.length === 0) {
    guarded.cons = ["No dominant negative theme detected in the available reviews."];
  }

  if (guarded.sentiment_clusters.length === 0) {
    guarded.sentiment_clusters = [{ theme: "Overall", sentiment: "mixed", count: 0 }];
  }

  return guarded;
}

module.exports = {
  runQualityGuardAgent,
};
