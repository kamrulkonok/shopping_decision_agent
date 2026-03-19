const reviewIntelligenceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schema.shopping-agent.ai/review-intelligence.schema.json",
  title: "Review Intelligence",
  description:
    "Structured review intelligence generated from product context and customer review analysis.",
  type: "object",
  required: [
    "reliability_score",
    "pros",
    "cons",
    "sentiment_clusters",
    "review_summary",
    "telemetry",
  ],
  properties: {
    reliability_score: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },
    reliability_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    pros: {
      type: "array",
      items: { type: "string" },
    },
    cons: {
      type: "array",
      items: { type: "string" },
    },
    sentiment_clusters: {
      type: "array",
      items: {
        type: "object",
        required: ["theme", "sentiment", "count"],
        properties: {
          theme: { type: "string" },
          sentiment: {
            type: "string",
            enum: ["positive", "mixed", "negative"],
          },
          count: { type: "integer", minimum: 0 },
        },
      },
    },
    review_summary: {
      type: "string",
    },
    telemetry: {
      type: "object",
      required: [
        "input_reviews",
        "usable_reviews",
        "deduped_reviews",
        "llm_used",
        "model",
        "blocked_by_captcha",
      ],
      properties: {
        input_reviews: { type: "integer", minimum: 0 },
        usable_reviews: { type: "integer", minimum: 0 },
        deduped_reviews: { type: "integer", minimum: 0 },
        llm_used: { type: "boolean" },
        model: { type: "string" },
        blocked_by_captcha: { type: "boolean" },
      },
    },
  },
};

const requiredFields = reviewIntelligenceSchema.required;

function validateReviewIntelligencePayload(payload) {
  const missingFields = requiredFields.filter(
    (field) => payload[field] === undefined || payload[field] === null
  );

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

module.exports = {
  reviewIntelligenceSchema,
  validateReviewIntelligencePayload,
};
