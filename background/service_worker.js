/**
 * service_worker.js – Background service worker.
 * Handles communication between popup and OpenAI API,
 * with per-ASIN session caching to avoid redundant API calls.
 */

'use strict';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const CACHE_KEY_PREFIX = 'analysis_';

// In-memory session cache (cleared when service worker is restarted)
const sessionCache = new Map();

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message.action === 'analyze') {
    handleAnalyze(message.productData)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message || 'Unknown error' }));
    return true; // Keep the message channel open for async response
  }
});

/**
 * Orchestrates the product analysis:
 * 1. Checks session cache
 * 2. Retrieves API key from storage
 * 3. Calls OpenAI
 * 4. Caches and returns result
 */
async function handleAnalyze(productData) {
  if (!productData) {
    return { error: 'No product data provided.' };
  }

  const cacheKey = CACHE_KEY_PREFIX + (productData.asin || productData.title);

  // Return cached result if available
  if (sessionCache.has(cacheKey)) {
    return { ...sessionCache.get(cacheKey), cached: true };
  }

  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (!apiKey || !apiKey.trim()) {
    return { error: 'api_key_missing' };
  }

  const analysis = await callOpenAI(apiKey.trim(), productData);

  // Cache the successful result
  if (!analysis.error) {
    sessionCache.set(cacheKey, analysis);
  }

  return analysis;
}

/**
 * Builds the prompt and calls the OpenAI Chat Completions API.
 */
async function callOpenAI(apiKey, productData) {
  const { title, brand, price, rating, reviewCount, features, reviews } = productData;

  const featureList = (features || []).slice(0, 8).join('\n- ');
  const reviewList = (reviews || []).slice(0, 10)
    .map((r, i) => `${i + 1}. ${r.substring(0, 300)}`)
    .join('\n');

  const systemPrompt =
    'You are an expert AI shopping assistant. Analyze product information and reviews to ' +
    'help users make informed purchase decisions. Always respond with valid JSON only, ' +
    'with no markdown or extra text.';

  const userPrompt =
    `Analyze this product and return a JSON shopping decision report.\n\n` +
    `Product Title: ${title || 'Unknown'}\n` +
    `Brand: ${brand || 'Unknown'}\n` +
    `Price: ${price || 'Unknown'}\n` +
    `Overall Rating: ${rating || 'Unknown'}\n` +
    `Total Reviews: ${reviewCount || 'Unknown'}\n\n` +
    `Key Features:\n${featureList ? '- ' + featureList : 'Not available'}\n\n` +
    `Sample Customer Reviews:\n${reviewList || 'Not available'}\n\n` +
    `Return JSON in EXACTLY this structure:\n` +
    `{\n` +
    `  "reliability_score": <number 0-10 with one decimal>,\n` +
    `  "summary": "<2-3 sentence product overview>",\n` +
    `  "pros": ["<pro 1>", "<pro 2>", "<pro 3>", "<pro 4>"],\n` +
    `  "cons": ["<con 1>", "<con 2>", "<con 3>"],\n` +
    `  "fake_review_analysis": {\n` +
    `    "risk_level": "<low|medium|high>",\n` +
    `    "risk_percentage": <integer 0-100>,\n` +
    `    "explanation": "<1-2 sentence explanation>"\n` +
    `  },\n` +
    `  "price_drop_prediction": {\n` +
    `    "likelihood": "<low|medium|high>",\n` +
    `    "timeframe": "<e.g. 30 days, 3 months, unlikely soon>",\n` +
    `    "explanation": "<1-2 sentence explanation>"\n` +
    `  },\n` +
    `  "alternatives": [\n` +
    `    {"name": "<competitor product>", "reason": "<why consider it>"},\n` +
    `    {"name": "<competitor product>", "reason": "<why consider it>"},\n` +
    `    {"name": "<competitor product>", "reason": "<why consider it>"}\n` +
    `  ]\n` +
    `}`;

  let response;
  try {
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500
      })
    });
  } catch (networkErr) {
    return { error: 'Network error – unable to reach OpenAI. Check your internet connection.' };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { error: 'invalid_api_key' };
    }
    if (response.status === 429) {
      return { error: 'OpenAI rate limit reached. Please wait a moment and try again.' };
    }
    return { error: `OpenAI API error (HTTP ${response.status}). Please try again.` };
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    return { error: 'Failed to parse OpenAI response. Please try again.' };
  }

  const content = data.choices && data.choices[0] && data.choices[0].message &&
    data.choices[0].message.content;

  if (!content) {
    return { error: 'Empty response from OpenAI. Please try again.' };
  }

  try {
    return JSON.parse(content);
  } catch (_) {
    return { error: 'OpenAI returned an invalid response format. Please try again.' };
  }
}
