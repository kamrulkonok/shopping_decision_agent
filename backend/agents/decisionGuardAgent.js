function asTrimmedString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeList(items, maxLength = 5) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const normalized = asTrimmedString(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxLength) break;
  }

  return result;
}

function normalizeRecommendation(value) {
  if (value === "buy" || value === "consider" || value === "avoid") return value;
  return "consider";
}

function normalizeDecisionState(value) {
  if (value === "sufficient_data" || value === "insufficient_data") return value;
  return "insufficient_data";
}

function runDecisionGuardAgent(payload) {
  const evidenceScore = clamp(Math.round(Number(payload?.evidence_score ?? 0)), 0, 100);
  const confidence = clamp(Number(payload?.confidence ?? 0.2), 0, 1);
  const decisionState = normalizeDecisionState(payload?.decision_state);
  const adjustmentPenalty = clamp(Math.round(Number(payload?.adjustment_penalty ?? 0)), 0, 100);

  let recommendation = normalizeRecommendation(payload?.recommendation);

  // Prevent hard-buy recommendations when evidence quality is weak.
  if (decisionState === "insufficient_data" || confidence < 0.55 || evidenceScore < 35) {
    if (recommendation === "buy") recommendation = "consider";
  }

  // Prevent hard-avoid recommendations when confidence is too low.
  if (recommendation === "avoid" && confidence < 0.35) {
    recommendation = "consider";
  }

  return {
    recommendation,
    decision_score: clamp(Math.round(Number(payload?.decision_score ?? 0)), 0, 100),
    confidence: Number(confidence.toFixed(2)),
    decision_state: decisionState,
    quality_score: clamp(Math.round(Number(payload?.quality_score ?? 0)), 0, 100),
    value_score: clamp(Math.round(Number(payload?.value_score ?? 0)), 0, 100),
    evidence_score: evidenceScore,
    adjustment_penalty: adjustmentPenalty,
    top_reasons: sanitizeList(payload?.top_reasons, 5),
    red_flags: sanitizeList(payload?.red_flags, 5),
    decision_algo_version: asTrimmedString(payload?.decision_algo_version, "decision-v1"),
  };
}

module.exports = {
  runDecisionGuardAgent,
};
