const decisionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schema.shopping-agent.ai/decision.schema.json",
  title: "Decision",
  description:
    "Structured buy/consider/avoid decision generated from product context and review intelligence.",
  type: "object",
  required: [
    "recommendation",
    "decision_score",
    "confidence",
    "decision_state",
    "quality_score",
    "value_score",
    "evidence_score",
    "risk_penalty",
    "top_reasons",
    "red_flags",
    "decision_algo_version",
  ],
  properties: {
    recommendation: {
      type: "string",
      enum: ["buy", "consider", "avoid"],
    },
    decision_score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    decision_state: {
      type: "string",
      enum: ["sufficient_data", "insufficient_data"],
    },
    quality_score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    value_score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    evidence_score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    risk_penalty: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    top_reasons: {
      type: "array",
      items: { type: "string" },
    },
    red_flags: {
      type: "array",
      items: { type: "string" },
    },
    decision_algo_version: {
      type: "string",
      minLength: 1,
    },
  },
};

const requiredFields = decisionSchema.required;

function validateDecisionPayload(payload) {
  const missingFields = requiredFields.filter(
    (field) => payload[field] === undefined || payload[field] === null
  );

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

module.exports = {
  decisionSchema,
  validateDecisionPayload,
};
