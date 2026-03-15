/**
 * popup.js – Orchestrates the extension popup UI.
 *
 * Flow:
 *  1. Check active tab is a supported Amazon product page
 *  2. Inject content.js and scrape product data
 *  3. Send data to service_worker.js → OpenAI API
 *  4. Render the analysis results
 */

'use strict';

// ─── Element references ─────────────────────────────────────

const $ = id => document.getElementById(id);

const states = {
  notProduct: $('stateNotProduct'),
  noKey:      $('stateNoKey'),
  loading:    $('stateLoading'),
  error:      $('stateError'),
  results:    $('stateResults')
};

// ─── Show/hide helpers ──────────────────────────────────────

function showState(name) {
  Object.values(states).forEach(el => el.classList.add('hidden'));
  states[name].classList.remove('hidden');
}

// ─── Supported page detection ───────────────────────────────

const AMAZON_PRODUCT_RE = /amazon\.(com|co\.uk|ca|de|fr|co\.jp|in|com\.au).*\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i;

function isSupportedUrl(url) {
  return url && AMAZON_PRODUCT_RE.test(url);
}

// ─── Score colour helper ────────────────────────────────────

function scoreColor(score) {
  if (score >= 7.5) return 'var(--green)';
  if (score >= 5)   return 'var(--yellow)';
  return 'var(--red)';
}

// ─── Risk-level badge helper ────────────────────────────────

function setRiskBadge(el, level) {
  const levelLower = (level || '').toLowerCase();
  el.textContent = levelLower.charAt(0).toUpperCase() + levelLower.slice(1);
  el.className = 'risk-badge ' + (levelLower || 'low');
}

// ─── Likelihood → colour mapping ────────────────────────────

function likelihoodColor(likelihood) {
  const l = (likelihood || '').toLowerCase();
  if (l === 'high')   return 'var(--red)';
  if (l === 'medium') return 'var(--yellow)';
  return 'var(--green)';
}

// ─── Render results ─────────────────────────────────────────

function renderResults(productData, analysis, cached) {
  // Product bar
  $('productTitle').textContent = productData.title || 'Product';
  $('productPrice').textContent = productData.price  || '';
  $('productRating').textContent = productData.rating ? '⭐ ' + productData.rating : '';

  // Score circle
  const score = parseFloat(analysis.reliability_score) || 0;
  $('scoreValue').textContent = score.toFixed(1);
  $('scoreCircle').style.background = scoreColor(score);

  // Summary
  $('summary').textContent = analysis.summary || '';

  // Pros
  const prosList = $('prosList');
  prosList.innerHTML = '';
  (analysis.pros || []).forEach(pro => {
    const li = document.createElement('li');
    li.textContent = pro;
    prosList.appendChild(li);
  });

  // Cons
  const consList = $('consList');
  consList.innerHTML = '';
  (analysis.cons || []).forEach(con => {
    const li = document.createElement('li');
    li.textContent = con;
    consList.appendChild(li);
  });

  // Fake review analysis
  const fakeData = analysis.fake_review_analysis || {};
  setRiskBadge($('fakeRiskBadge'), fakeData.risk_level);
  const riskPct = Math.min(100, Math.max(0, parseInt(fakeData.risk_percentage) || 0));
  $('riskBar').style.width = riskPct + '%';
  $('riskBar').style.background = riskPct > 50 ? 'var(--red)' : riskPct > 25 ? 'var(--yellow)' : 'var(--green)';
  $('riskPercent').textContent = riskPct + '%';
  $('fakeExplanation').textContent = fakeData.explanation || '';

  // Price drop prediction
  // Note: for price-drop likelihood the badge colour semantics are *inverted* compared
  // to fake-review risk: a HIGH likelihood of a price drop is good news (green badge),
  // while LOW likelihood means the user will likely have to pay full price (red badge).
  const priceData = analysis.price_drop_prediction || {};
  const priceBadge = $('priceLikelihoodBadge');
  const pLevelLower = (priceData.likelihood || '').toLowerCase();
  priceBadge.className = 'risk-badge ' +
    (pLevelLower === 'high' ? 'low' : pLevelLower === 'medium' ? 'medium' : 'high');
  priceBadge.textContent = pLevelLower.charAt(0).toUpperCase() + pLevelLower.slice(1) + ' likelihood';

  $('priceTimeframe').textContent = priceData.timeframe ? '⏱ ' + priceData.timeframe : '';
  $('priceExplanation').textContent = priceData.explanation || '';

  // Alternatives
  const altsList = $('alternativesList');
  altsList.innerHTML = '';
  (analysis.alternatives || []).forEach(alt => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="alt-name">${escapeHtml(alt.name || '')}</div>` +
      `<div class="alt-reason">${escapeHtml(alt.reason || '')}</div>`;
    altsList.appendChild(li);
  });

  // Cached indicator
  if (cached) {
    $('cachedNote').classList.remove('hidden');
  } else {
    $('cachedNote').classList.add('hidden');
  }

  showState('results');
}

// ─── Simple HTML escape ─────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Main analysis flow ─────────────────────────────────────

let currentTab = null;

async function runAnalysis(forceRefresh) {
  showState('loading');

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Guard: must be a supported product URL
  if (!isSupportedUrl(tab.url)) {
    showState('notProduct');
    return;
  }

  // Inject the content script (idempotent – Chrome ignores re-injection errors)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
  } catch (_) {
    // May fail on restricted pages; fall through to get error from content script
  }

  // Show product title hint while loading
  $('loadingProduct').textContent = tab.title ? tab.title.substring(0, 60) + '…' : '';

  // Ask the content script to scrape the page
  let productData;
  try {
    productData = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
  } catch (err) {
    showError('Could not read the page.', 'Make sure you are on an Amazon product page and reload it, then try again.');
    return;
  }

  if (!productData || productData.error === 'not_product_page') {
    showState('notProduct');
    return;
  }

  // Send to service worker for AI analysis (pass forceRefresh so it can bust the cache)
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      action: 'analyze',
      productData,
      forceRefresh: !!forceRefresh
    });
  } catch (err) {
    showError('Extension error', err.message || 'Unknown error');
    return;
  }

  if (!response) {
    showError('No response', 'The background worker did not respond. Try reloading the extension.');
    return;
  }

  if (response.error === 'api_key_missing') {
    showState('noKey');
    return;
  }

  if (response.error === 'invalid_api_key') {
    showError('Invalid API Key', 'Your OpenAI API key was rejected. Please check it in Settings.');
    return;
  }

  if (response.error) {
    showError('Analysis failed', response.error);
    return;
  }

  renderResults(productData, response, !!response.cached);
}

function showError(title, message) {
  $('errorTitle').textContent = title;
  $('errorMsg').textContent = message;
  showState('error');
}

// ─── Event listeners ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  // Open settings page
  $('settingsBtn').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  $('goToSettingsBtn').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  // Retry after error
  $('retryBtn').addEventListener('click', function () {
    runAnalysis(false);
  });

  // Force re-analyse (bypasses session cache)
  $('refreshBtn').addEventListener('click', function () {
    runAnalysis(true);
  });

  // Start analysis automatically when popup opens
  runAnalysis(false);
});
