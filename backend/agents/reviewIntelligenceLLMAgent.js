const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");

const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER || "auto").toLowerCase();
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";

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
  const negatives = validReviews.filter((review) => Number(review.review_rating || 0) <= 2);

  const pros = positives
    .map((review) => review.review_title || review.review_text)
    .filter(Boolean)
    .slice(0, 3);

  const cons = negatives
    .map((review) => review.review_title || review.review_text)
    .filter(Boolean)
    .slice(0, 3);

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

function buildPromptPayload(productContext, reviews) {
  const compactReviews = (reviews || []).slice(0, 80).map((review) => ({
    rating: review.review_rating,
    title: String(review.review_title || "").slice(0, 180),
    text: String(review.review_text || "").slice(0, 700),
    verified_purchase: Boolean(review.verified_purchase),
    helpful_votes: review.helpful_votes || 0,
  }));

  return {
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

async function callOpenAI(promptPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const userPrompt = buildUserPrompt(promptPayload);
  const systemPrompt = buildSystemPrompt();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
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
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned empty content.");
  }

  const parsed = JSON.parse(content);
  return {
    ...parsed,
    llm_used: true,
    llm_model: DEFAULT_OPENAI_MODEL,
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

function getProviderOrder() {
  if (DEFAULT_PROVIDER === "mistral") return ["mistral"];
  if (DEFAULT_PROVIDER === "openai") return ["openai"];

  // auto mode: prefer Mistral first, then OpenAI.
  return ["mistral", "openai"];
}

async function runReviewIntelligenceLLMAgent({ productContext, reviews }) {
  const fallback = buildFallbackReviewIntelligence(reviews);
  const promptPayload = buildPromptPayload(productContext, reviews);
  const providerErrors = [];

  const callers = {
    mistral: callMistral,
    openai: callOpenAI,
  };

  for (const provider of getProviderOrder()) {
    try {
      return await callers[provider](promptPayload);
    } catch (error) {
      providerErrors.push(`${provider}: ${error.message}`);
    }
  }

  return {
    ...fallback,
    llm_error: `LLM error: ${providerErrors.join(" | ")}`,
  };
}

module.exports = {
  runReviewIntelligenceLLMAgent,
};
