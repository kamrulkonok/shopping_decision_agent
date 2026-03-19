const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");

const DEFAULT_MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const PIVOT_LANGUAGE = (process.env.PIVOT_LANGUAGE || "en").toLowerCase();
const MULTILINGUAL_NORMALIZATION_ENABLED =
  String(process.env.MULTILINGUAL_NORMALIZATION_ENABLED || "true").toLowerCase() !== "false";
const TRANSLATE_TO_PIVOT_BEFORE_CLUSTERING =
  String(process.env.TRANSLATE_TO_PIVOT_BEFORE_CLUSTERING || "true").toLowerCase() !== "false";

const SYSTEM_PROMPT_PATH = path.resolve(
  __dirname,
  "../prompts/review-intelligence-system.prompt.jinja2"
);
const USER_PROMPT_PATH = path.resolve(
  __dirname,
  "../prompts/review-intelligence-user.prompt.jinja2"
);

function readPromptFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (error) {
    throw new Error(`Failed to load prompt file at ${filePath}: ${error.message}`);
  }
}

const REVIEW_INTELLIGENCE_SYSTEM_PROMPT = readPromptFile(SYSTEM_PROMPT_PATH);
const REVIEW_INTELLIGENCE_USER_PROMPT_TEMPLATE = readPromptFile(USER_PROMPT_PATH);

const templateEnv = new nunjucks.Environment(undefined, {
  autoescape: false,
  throwOnUndefined: false,
});

function renderPrompt(template, context) {
  try {
    return templateEnv.renderString(template, context).trim();
  } catch (error) {
    throw new Error(`Failed to render prompt template: ${error.message}`);
  }
}

function buildUserPrompt(promptPayload) {
  return renderPrompt(REVIEW_INTELLIGENCE_USER_PROMPT_TEMPLATE, {
    payload_json: JSON.stringify(promptPayload),
  });
}

function buildSystemPrompt() {
  return renderPrompt(REVIEW_INTELLIGENCE_SYSTEM_PROMPT, {});
}

function buildFallbackReviewIntelligence(reviews) {
  const validReviews = Array.isArray(reviews) ? reviews : [];
  const positives = validReviews.filter((review) => Number(review.review_rating || 0) >= 4);
  const negatives = validReviews.filter((review) => Number(review.review_rating || 0) <= 3);

  const pros = positives
    .map((review) => review.review_title || review.review_text)
    .filter(Boolean)
    .slice(0, 5);

  const cons = negatives
    .map((review) => review.review_title || review.review_text)
    .filter(Boolean)
    .slice(0, 5);

  const average =
    validReviews.length > 0
      ? validReviews.reduce((sum, review) => sum + Number(review.review_rating || 0), 0) /
        validReviews.length
      : 0;

  return {
    pros:
      pros.length > 0 ? pros : ["Positive signals are limited in the currently available review sample."],
    cons:
      cons.length > 0 ? cons : ["Negative signals are limited in the currently available review sample."],
    sentiment_clusters: [
      {
        theme: "Overall Satisfaction",
        sentiment: average >= 4 ? "positive" : average >= 3 ? "mixed" : "negative",
        count: validReviews.length,
      },
    ],
    review_summary:
      validReviews.length > 0
        ? `Fallback analysis based on ${validReviews.length} reviews indicates generally ${
            average >= 4 ? "positive" : average >= 3 ? "mixed" : "negative"
          } customer sentiment.`
        : "Fallback analysis could not infer meaningful sentiment because no usable reviews were available.",
    llm_used: false,
    llm_model: "fallback-heuristic",
  };
}

function normalizeFreeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectLanguageHeuristic(value) {
  const text = normalizeFreeText(value);
  if (!text) return "unknown";

  if (/[\u3040-\u30FF]/.test(text)) return "ja"; // Hiragana/Katakana
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh"; // CJK Unified Ideographs
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko"; // Hangul
  if (/[\u0400-\u04FF]/.test(text)) return "ru"; // Cyrillic
  if (/[\u0600-\u06FF]/.test(text)) return "ar"; // Arabic

  const lowered = text.toLowerCase();
  const spanishHints = [" el ", " la ", " de ", " y ", " muy ", " bateria", " camara"];
  const frenchHints = [" le ", " la ", " de ", " et ", " tres ", " bon", " mauvaise"];
  const germanHints = [" der ", " die ", " und ", " ist ", " sehr ", " nicht"];

  const hasAccent = /[à-ÿ]/i.test(lowered);

  if (spanishHints.some((token) => lowered.includes(token)) || /[ñáéíóúü]/i.test(lowered)) {
    return "es";
  }
  if (frenchHints.some((token) => lowered.includes(token))) {
    return "fr";
  }
  if (germanHints.some((token) => lowered.includes(token)) || /[äöüß]/i.test(lowered)) {
    return "de";
  }
  if (hasAccent) return "unknown";

  return "en";
}

function buildLanguageDistribution(reviews) {
  const distribution = {};
  for (const review of reviews) {
    const lang = review.detected_language || "unknown";
    distribution[lang] = (distribution[lang] || 0) + 1;
  }
  return distribution;
}

function normalizeReviewsForClustering(reviews) {
  const sourceReviews = Array.isArray(reviews) ? reviews : [];
  const normalizedReviews = sourceReviews.map((review) => {
    const title = normalizeFreeText(review.review_title);
    const text = normalizeFreeText(review.review_text);
    const merged = `${title} ${text}`.trim();
    const detectedLanguage = MULTILINGUAL_NORMALIZATION_ENABLED
      ? detectLanguageHeuristic(merged)
      : "en";

    return {
      ...review,
      review_title: title,
      review_text: text,
      detected_language: detectedLanguage,
    };
  });

  const languageDistribution = buildLanguageDistribution(normalizedReviews);

  return {
    reviews: normalizedReviews,
    telemetry: {
      multilingual_normalization_enabled: MULTILINGUAL_NORMALIZATION_ENABLED,
      translate_to_pivot_before_clustering: TRANSLATE_TO_PIVOT_BEFORE_CLUSTERING,
      pivot_language: PIVOT_LANGUAGE,
      language_distribution: languageDistribution,
      non_english_review_count: normalizedReviews.filter(
        (review) => review.detected_language !== "en" && review.detected_language !== "unknown"
      ).length,
    },
  };
}

function buildPromptPayload(productContext, reviews) {
  const compactReviews = (reviews || []).slice(0, 150).map((review) => ({
    rating: review.review_rating,
    title: String(review.review_title || "").slice(0, 180),
    text: String(review.review_text || "").slice(0, 700),
    detected_language: review.detected_language || "unknown",
    verified_purchase: Boolean(review.verified_purchase),
    helpful_votes: review.helpful_votes || 0,
  }));

  return {
    normalization: {
      pivot_language: PIVOT_LANGUAGE,
      multilingual_normalization_enabled: MULTILINGUAL_NORMALIZATION_ENABLED,
      translate_to_pivot_before_clustering: TRANSLATE_TO_PIVOT_BEFORE_CLUSTERING,
    },
    product: {
      product_id: productContext.product_id,
      product_title: productContext.product_title,
      category: productContext.category,
      average_rating: productContext.average_rating,
      total_ratings: productContext.total_ratings,
      price: productContext.price,
      currency: productContext.currency,
    },
    reviews: compactReviews,
  };
}

function parseModelJsonContent(content) {
  if (!content) {
    throw new Error("Model returned empty content.");
  }

  if (typeof content === "object") {
    return content;
  }

  if (typeof content !== "string") {
    throw new Error("Model returned an unsupported content format.");
  }

  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some providers occasionally wrap JSON in markdown fences.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      return JSON.parse(fenced[1]);
    }
    throw new Error("Model response was not valid JSON.");
  }
}

async function callMistral(promptPayload) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not configured.");
  }

  const userPrompt = buildUserPrompt(promptPayload);
  const systemPrompt = buildSystemPrompt();

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MISTRAL_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = parseModelJsonContent(content);

  return {
    ...parsed,
    llm_used: true,
    llm_model: DEFAULT_MISTRAL_MODEL,
  };
}

async function runReviewIntelligenceLLMAgent({ productContext, reviews }) {
  const fallback = buildFallbackReviewIntelligence(reviews);
  const normalized = normalizeReviewsForClustering(reviews);
  const promptPayload = buildPromptPayload(productContext, normalized.reviews);
  try {
    const llmResult = await callMistral(promptPayload);
    return {
      ...llmResult,
      normalization_telemetry: normalized.telemetry,
    };
  } catch (error) {
    return {
      ...fallback,
      normalization_telemetry: normalized.telemetry,
      llm_error: `LLM error: mistral: ${error.message}`,
    };
  }

}

module.exports = {
  runReviewIntelligenceLLMAgent,
};
