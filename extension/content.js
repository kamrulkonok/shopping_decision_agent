(() => {
  const LOG_PREFIX = "[AI Shopping Agent]";

  if (window.__aiShoppingAgentExtractorRan) {
    console.log(`${LOG_PREFIX} extractor already ran on this page`);
    return;
  }
  window.__aiShoppingAgentExtractorRan = true;
  console.log(`${LOG_PREFIX} content script loaded`);

  const CONFIG = {
    maxAttempts: 20,
    intervalMs: 500,
    maxReviewPages: 10,
    maxReviews: 250,
    reviewSorts: ["recent", "helpful"],
    backendUrl: "http://localhost:3000/analyze-reviews",
    sessionPostedAsinsKey: "ai-shopping-agent-posted-asins",
    forceResendOnceKey: "ai-shopping-agent-force-resend-once",
    analysisCachePrefix: "ai-shopping-agent-analysis",
  };

  const UI = {
    panelId: "ai-shopping-agent-analysis-panel",
  };

  let latestProductContext = null;
  let isAnalysisRunning = false;

  const SELECTORS = {
    title: ["#productTitle"],
    price: [
      ".apex-core-price-identifier .a-price .a-offscreen",
      ".a-price .a-offscreen",
      "span[data-a-color='price'] .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      "#corePrice_feature_div .a-offscreen",
      ".priceToPay .a-offscreen",
    ],
    priceFallback: [
      "#price_inside_buybox",
      "#newBuyBoxPrice",
      "#tp_price_block_total_price_ww .a-offscreen",
      "#sns-base-price",
      "#kindle-price",
    ],
    rating: [
      "#averageCustomerReviews .a-icon-alt",
      "span[data-hook='rating-out-of-text']",
      ".a-icon-star .a-icon-alt",
    ],
    totalRatings: ["#acrCustomerReviewText", "[data-hook='total-review-count']"],
    brand: ["#bylineInfo", "#brand", "a#bylineInfo", "tr.po-brand td.a-span9 span"],
    description: [
      "#productDescription p",
      "#bookDescription_feature_div .a-expander-content",
    ],
    features: [
      "#feature-bullets .a-list-item",
      "#feature-bullets li",
      "#detailBullets_feature_div .a-list-item",
      "#detailBulletsWrapper_feature_div .a-list-item",
      "#productFactsDesktop_feature_div .a-list-item",
      "#aplus_feature_div li",
    ],
    reviewContainers: ["[data-hook='review']", "div[id^='customer_review-']", ".review"],
    seeAllReviewsLink: "a[data-hook='see-all-reviews-link-foot'], #acrCustomerReviewLink",
    nextReviewPageLink: "li.a-last a, .a-pagination li.a-last a",
  };

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function errorLog(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  function getFirstElement(selectors, root = document) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function getText(selectors, fallback = "", root = document) {
    const el = getFirstElement(selectors, root);
    return el ? el.textContent.trim() : fallback;
  }

  function parseFirstNumber(value) {
    if (!value) return 0;
    const match = value.replace(/,/g, "").match(/\d+(\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function parsePrice(value) {
    if (!value) return 0;
    const cleaned = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
    const amount = Number.parseFloat(cleaned);
    return Number.isFinite(amount) ? amount : 0;
  }

  function getPriceFromWholeFraction() {
    const whole = document.querySelector(".a-price .a-price-whole")?.textContent?.trim();
    const fraction = document.querySelector(".a-price .a-price-fraction")?.textContent?.trim();

    if (!whole) return "";
    const normalizedWhole = whole.replace(/[^\d]/g, "");
    const normalizedFraction = (fraction || "00").replace(/[^\d]/g, "");

    if (!normalizedWhole) return "";
    return `${normalizedWhole}.${normalizedFraction}`;
  }

  function extractPriceFromJsonLd() {
    const jsonLdScripts = Array.from(
      document.querySelectorAll("script[type='application/ld+json']")
    );

    for (const script of jsonLdScripts) {
      const raw = script.textContent?.trim();
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed : [parsed];

        for (const entry of entries) {
          const offers = entry?.offers;
          if (!offers) continue;

          if (Array.isArray(offers)) {
            const first = offers.find((item) => item?.price);
            if (first?.price) return String(first.price);
          } else if (offers?.price) {
            return String(offers.price);
          }
        }
      } catch {
        // Ignore invalid JSON-LD blocks.
      }
    }

    return "";
  }

  function extractCurrencyFromJsonLd() {
    const jsonLdScripts = Array.from(
      document.querySelectorAll("script[type='application/ld+json']")
    );

    for (const script of jsonLdScripts) {
      const raw = script.textContent?.trim();
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed : [parsed];

        for (const entry of entries) {
          const offers = entry?.offers;
          if (!offers) continue;

          if (Array.isArray(offers)) {
            const first = offers.find((item) => item?.priceCurrency);
            if (first?.priceCurrency) return String(first.priceCurrency).toUpperCase();
          } else if (offers?.priceCurrency) {
            return String(offers.priceCurrency).toUpperCase();
          }
        }
      } catch {
        // Ignore invalid JSON-LD blocks.
      }
    }

    return "";
  }

  function extractRawPriceText() {
    const primary = getText(SELECTORS.price, "");
    if (primary) return primary;

    const fallback = getText(SELECTORS.priceFallback, "");
    if (fallback) return fallback;

    const wholeFraction = getPriceFromWholeFraction();
    if (wholeFraction) return wholeFraction;

    return extractPriceFromJsonLd();
  }

  function extractCurrency(rawPrice) {
    const currencyFromMeta =
      document.querySelector("meta[itemprop='priceCurrency']")?.getAttribute("content") ||
      document
        .querySelector("meta[property='product:price:currency']")
        ?.getAttribute("content") ||
      "";

    if (currencyFromMeta) return currencyFromMeta.toUpperCase();

    const currencyFromJsonLd = extractCurrencyFromJsonLd();
    if (currencyFromJsonLd) return currencyFromJsonLd;

    if (!rawPrice) return "USD";
    if (rawPrice.includes("$") || /USD/i.test(rawPrice)) return "USD";
    if (rawPrice.includes("EUR") || rawPrice.includes("€")) return "EUR";
    if (rawPrice.includes("GBP") || rawPrice.includes("£")) return "GBP";
    return "USD";
  }

  function extractAsin() {
    const fromInput = document.querySelector("input#ASIN")?.value?.trim();
    if (fromInput) return fromInput;

    const fromUrl = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
    if (fromUrl && fromUrl[1]) return fromUrl[1].toUpperCase();

    return "UNKNOWN-ASIN";
  }

  function extractCategory() {
    const breadcrumbLinks = Array.from(
      document.querySelectorAll("#wayfinding-breadcrumbs_feature_div ul li a")
    )
      .map((el) => el.textContent.trim())
      .filter(Boolean);

    return breadcrumbLinks.length > 0 ? breadcrumbLinks[0] : "Unknown Category";
  }

  function normalizeBrandName(rawBrand) {
    if (!rawBrand) return "Unknown Brand";

    return rawBrand
      .replace(/^\s*Visit the\s+/i, "")
      .replace(/\s+Store\s*$/i, "")
      .replace(/^\s*Brand:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractDescription() {
    const description = getText(SELECTORS.description);
    if (description) return description;

    const firstFeature = getText(SELECTORS.features);
    return firstFeature || "No description available";
  }

  function extractFeatures() {
    const allFeatureItems = SELECTORS.features.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
    );

    return Array.from(
      new Set(
        allFeatureItems
          .map((item) => item.textContent.replace(/\s+/g, " ").trim())
          .filter((text) => text && text.length > 3)
      )
    );
  }

  function getPostedAsinSetFromSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.sessionPostedAsinsKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed);
    } catch {
      return new Set();
    }
  }

  function markAsinPostedInSession(asin) {
    const set = getPostedAsinSetFromSession();
    set.add(asin);
    try {
      sessionStorage.setItem(CONFIG.sessionPostedAsinsKey, JSON.stringify(Array.from(set)));
    } catch {
      // If storage is blocked, continue silently.
    }
  }

  function hasAsinBeenPostedInSession(asin) {
    return getPostedAsinSetFromSession().has(asin);
  }

  function shouldForceResendOnce() {
    try {
      const isEnabled = sessionStorage.getItem(CONFIG.forceResendOnceKey) === "1";
      if (isEnabled) {
        sessionStorage.removeItem(CONFIG.forceResendOnceKey);
        return true;
      }
    } catch {
      // If storage access is blocked, just fall back to normal behavior.
    }
    return false;
  }

  function canUseChromeStorageLocal() {
    return Boolean(chrome?.storage?.local);
  }

  function getAnalysisCacheKey(asin) {
    return `${CONFIG.analysisCachePrefix}:${asin}`;
  }

  function loadCachedAnalysisForAsin(asin) {
    return new Promise((resolve) => {
      if (!asin || asin === "UNKNOWN-ASIN" || !canUseChromeStorageLocal()) {
        resolve(null);
        return;
      }

      const key = getAnalysisCacheKey(asin);
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime?.lastError) {
          warn("Could not read cached analysis:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }

        resolve(result?.[key] || null);
      });
    });
  }

  function saveCachedAnalysisForAsin(asin, payload) {
    return new Promise((resolve) => {
      if (!asin || asin === "UNKNOWN-ASIN" || !canUseChromeStorageLocal()) {
        resolve(false);
        return;
      }

      const key = getAnalysisCacheKey(asin);
      const value = {
        asin,
        saved_at: new Date().toISOString(),
        payload,
      };

      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime?.lastError) {
          warn("Could not save cached analysis:", chrome.runtime.lastError.message);
          resolve(false);
          return;
        }

        resolve(true);
      });
    });
  }

  function upsertPanelRoot() {
    let panel = document.getElementById(UI.panelId);
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = UI.panelId;
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.width = "360px";
    panel.style.maxHeight = "70vh";
    panel.style.overflow = "auto";
    panel.style.zIndex = "2147483647";
    panel.style.background = "#ffffff";
    panel.style.color = "#111827";
    panel.style.border = "1px solid #e5e7eb";
    panel.style.borderRadius = "12px";
    panel.style.padding = "12px";
    panel.style.boxShadow = "0 12px 30px rgba(0,0,0,0.18)";
    panel.style.fontFamily = "ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
    panel.style.fontSize = "12px";
    panel.style.lineHeight = "1.4";

    document.body.appendChild(panel);
    return panel;
  }

  function createListHtml(items) {
    const safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length === 0) {
      return "<li>None</li>";
    }

    return safeItems
      .slice(0, 8)
      .map((item) => `<li>${String(item).replace(/</g, "&lt;")}</li>`)
      .join("");
  }

  function renderAnalysisPanel({ productContext, intelligence, source }) {
    if (!productContext || !intelligence) return;

    const panel = upsertPanelRoot();
    const asin = productContext.product_id || "UNKNOWN-ASIN";
    const title = productContext.product_title || "Unknown Product";
    const model = intelligence?.telemetry?.model || intelligence?.llm_model || "unknown";
    const llmUsed = intelligence?.telemetry?.llm_used;
    const score = intelligence?.reliability_score ?? "n/a";
    const risk = intelligence?.fake_review_risk || "unknown";
    const summary = intelligence?.review_summary || "No summary available.";

    panel.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
        <strong style="font-size:13px;">AI Review Intelligence</strong>
        <button id="ai-shopping-agent-rerun-btn" style="border:1px solid #d1d5db; background:#f9fafb; color:#111827; border-radius:8px; padding:6px 8px; cursor:pointer; font-size:12px;">Re-run Analysis</button>
      </div>
      <div style="margin-bottom:8px; color:#374151;"><strong>ASIN:</strong> ${asin}</div>
      <div style="margin-bottom:8px; color:#111827;"><strong>Title:</strong> ${String(title).replace(/</g, "&lt;")}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
        <div><strong>Score:</strong> ${score}</div>
        <div><strong>Risk:</strong> ${risk}</div>
        <div><strong>LLM:</strong> ${llmUsed ? "yes" : "no"}</div>
        <div><strong>Model:</strong> ${String(model).replace(/</g, "&lt;")}</div>
      </div>
      <div style="margin-bottom:8px; color:#6b7280;"><strong>Source:</strong> ${source}</div>
      <div style="margin-bottom:10px;"><strong>Summary:</strong><br>${String(summary).replace(/</g, "&lt;")}</div>
      <div style="margin-bottom:8px;"><strong>Pros</strong><ul style="margin:6px 0 0 18px;">${createListHtml(intelligence?.pros)}</ul></div>
      <div style="margin-bottom:4px;"><strong>Cons</strong><ul style="margin:6px 0 0 18px;">${createListHtml(intelligence?.cons)}</ul></div>
    `;

    const rerunButton = panel.querySelector("#ai-shopping-agent-rerun-btn");
    if (rerunButton) {
      rerunButton.addEventListener("click", () => {
        runAnalysisFlow({ forceResend: true, trigger: "rerun-button" });
      });
    }
  }

  function normalizeReviewDate(rawDateText) {
    if (!rawDateText) return "1970-01-01";

    const cleaned = rawDateText
      .replace(/^Reviewed in .* on\s+/i, "")
      .replace(/^Reviewed .* on\s+/i, "")
      .trim();

    const date = new Date(cleaned);
    return Number.isNaN(date.getTime()) ? "1970-01-01" : date.toISOString().slice(0, 10);
  }

  function parseHelpfulVotes(rawVotesText) {
    if (!rawVotesText) return 0;
    if (/one person/i.test(rawVotesText)) return 1;
    return Math.round(parseFirstNumber(rawVotesText));
  }

  function normalizeReviewTitle(rawTitle) {
    if (!rawTitle) return "";
    return rawTitle
      .replace(/^\d(\.\d)?\s+out of 5 stars\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeReviewText(rawText) {
    if (!rawText) return "";
    return rawText.replace(/\s*Read more\s*$/i, "").replace(/\s+/g, " ").trim();
  }

  function extractReviewFromNode(reviewEl, index) {
    const reviewId = reviewEl.getAttribute("id") || `review-${index + 1}`;
    const rawReviewTitle =
      reviewEl
        .querySelector("[data-hook='review-title'] span:last-child, [data-hook='review-title']")
        ?.textContent?.trim() || "";
    const rawReviewText =
      reviewEl.querySelector("[data-hook='review-body'] span, [data-hook='review-body']")
        ?.textContent?.trim() || "";
    const rawReviewRating =
      reviewEl
        .querySelector(
          "[data-hook='review-star-rating'] .a-icon-alt, [data-hook='cmps-review-star-rating'] .a-icon-alt"
        )
        ?.textContent?.trim() || "";
    const rawReviewDate =
      reviewEl.querySelector("[data-hook='review-date']")?.textContent?.trim() || "";
    const helpfulVotesText =
      reviewEl.querySelector("[data-hook='helpful-vote-statement']")?.textContent?.trim() || "";

    return {
      review_id: reviewId,
      review_title: normalizeReviewTitle(rawReviewTitle),
      review_text: normalizeReviewText(rawReviewText),
      review_rating: parseFirstNumber(rawReviewRating),
      review_date: normalizeReviewDate(rawReviewDate),
      verified_purchase: Boolean(reviewEl.querySelector("[data-hook='avp-badge']")),
      helpful_votes: parseHelpfulVotes(helpfulVotesText),
    };
  }

  function collectReviewNodes(rootDoc) {
    const candidates = SELECTORS.reviewContainers.flatMap((selector) =>
      Array.from(rootDoc.querySelectorAll(selector))
    );

    return Array.from(new Set(candidates)).filter((node) => {
      if (!(node instanceof Element)) return false;
      return (
        node.querySelector("[data-hook='review-body']") ||
        node.querySelector("[data-hook='review-star-rating']") ||
        node.id.startsWith("customer_review-")
      );
    });
  }

  function extractReviewsFromDocument(rootDoc) {
    return collectReviewNodes(rootDoc).map((node, index) => extractReviewFromNode(node, index));
  }

  function deduplicateReviews(reviews) {
    const seen = new Set();
    const deduped = [];

    for (const review of reviews) {
      const key = review.review_id || `${review.review_title}-${review.review_date}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(review);
      }
    }

    return deduped;
  }

  function getReviewListingBaseUrl(asin) {
    const canonicalPath = `/product-reviews/${asin}`;
    const seeAllLink = document.querySelector(SELECTORS.seeAllReviewsLink);
    if (seeAllLink && seeAllLink.getAttribute("href")) {
      const fromLink = new URL(seeAllLink.getAttribute("href"), window.location.origin);
      fromLink.pathname = canonicalPath;
      return fromLink;
    }

    return new URL(canonicalPath, window.location.origin);
  }

  function buildInitialReviewPageUrl(asin, sortBy) {
    const url = getReviewListingBaseUrl(asin);
    url.searchParams.set("pageNumber", "1");
    url.searchParams.set("reviewerType", "all_reviews");
    url.searchParams.set("sortBy", sortBy);
    return url.toString();
  }

  function findNextReviewPageUrl(parsedDoc, currentUrl, sortBy) {
    const nextLink = parsedDoc.querySelector(SELECTORS.nextReviewPageLink);
    if (!nextLink) return null;

    const href = nextLink.getAttribute("href");
    if (!href) return null;

    const nextUrl = new URL(href, currentUrl);
    nextUrl.searchParams.set("reviewerType", "all_reviews");
    nextUrl.searchParams.set("sortBy", sortBy);
    return nextUrl.toString();
  }

  function isBlockedPage(parsedDoc) {
    const title = parsedDoc.querySelector("title")?.textContent?.toLowerCase() || "";
    const bodyText = parsedDoc.body?.textContent?.toLowerCase() || "";
    return (
      title.includes("robot check") ||
      title.includes("enter the characters") ||
      bodyText.includes("type the characters you see") ||
      bodyText.includes("sorry, we just need to make sure you're not a robot")
    );
  }

  async function fetchReviewsBySort(asin, sortBy) {
    const collected = [];
    const seenUrls = new Set();
    let nextUrl = buildInitialReviewPageUrl(asin, sortBy);
    let pagesFetched = 0;
    let blockedByCaptcha = false;

    while (
      nextUrl &&
      pagesFetched < CONFIG.maxReviewPages &&
      collected.length < CONFIG.maxReviews
    ) {
      if (seenUrls.has(nextUrl)) break;
      seenUrls.add(nextUrl);
      pagesFetched += 1;

      try {
        log(`Fetching review page ${pagesFetched} (sort=${sortBy}):`, nextUrl);

        const response = await fetch(nextUrl, {
          method: "GET",
          credentials: "include",
        });

        if (!response.ok) {
          warn(`Review page fetch failed (sort=${sortBy}) with status`, response.status);
          break;
        }

        const html = await response.text();
        const parsedDoc = new DOMParser().parseFromString(html, "text/html");

        if (isBlockedPage(parsedDoc)) {
          warn(`Review page (sort=${sortBy}) appears blocked by Amazon anti-bot checks.`);
          blockedByCaptcha = true;
          break;
        }

        const pageReviews = extractReviewsFromDocument(parsedDoc);
        if (pageReviews.length === 0) {
          const pageTitle = parsedDoc.querySelector("title")?.textContent?.trim() || "(no title)";
          log(`No reviews on fetched page (sort=${sortBy}). Parsed title: ${pageTitle}`);
          break;
        }

        collected.push(...pageReviews);
        nextUrl = findNextReviewPageUrl(parsedDoc, nextUrl, sortBy);
      } catch (err) {
        errorLog(`Error fetching review page (sort=${sortBy}):`, err);
        break;
      }
    }

    return {
      reviews: deduplicateReviews(collected),
      pagesFetched,
      blockedByCaptcha,
    };
  }

  async function fetchPaginatedReviews(asin) {
    if (!asin || asin === "UNKNOWN-ASIN") {
      return {
        reviews: [],
        pagesFetched: 0,
        blockedByCaptcha: false,
      };
    }

    const combined = [];
    let pagesFetched = 0;
    let blockedByCaptcha = false;

    for (const sortBy of CONFIG.reviewSorts) {
      if (combined.length >= CONFIG.maxReviews) break;
      const result = await fetchReviewsBySort(asin, sortBy);
      combined.push(...result.reviews);
      pagesFetched += result.pagesFetched;
      blockedByCaptcha = blockedByCaptcha || result.blockedByCaptcha;
    }

    return {
      reviews: deduplicateReviews(combined).slice(0, CONFIG.maxReviews),
      pagesFetched,
      blockedByCaptcha,
    };
  }

  async function extractProductContext() {
    const asin = extractAsin();
    const rawPrice = extractRawPriceText();
    const rawRating = getText(SELECTORS.rating, "");
    const totalRatingsText = getText(SELECTORS.totalRatings, "");

    const visibleReviews = extractReviewsFromDocument(document);
    const paginationResult = await fetchPaginatedReviews(asin);
    const paginatedReviews = paginationResult.reviews;
    const reviews = deduplicateReviews([...visibleReviews, ...paginatedReviews]).slice(
      0,
      CONFIG.maxReviews
    );

    return {
      product_id: asin,
      product_title: getText(SELECTORS.title, "Unknown Title"),
      brand: normalizeBrandName(getText(SELECTORS.brand, "Unknown Brand")),
      category: extractCategory(),
      description: extractDescription(),
      price: parsePrice(rawPrice),
      currency: extractCurrency(rawPrice),
      average_rating: parseFirstNumber(rawRating),
      total_ratings: Math.round(parseFirstNumber(totalRatingsText)),
      features: extractFeatures(),
      reviews,
      reviews_visible_count: visibleReviews.length,
      reviews_paginated_count: paginatedReviews.length,
      pages_fetched: paginationResult.pagesFetched,
      blocked_by_captcha: paginationResult.blockedByCaptcha,
    };
  }

  function showProductBanner(productContext) {
    const banner = document.createElement("div");
    banner.textContent = `Title: ${productContext.product_title} | Price: ${productContext.price} ${productContext.currency} | Rating: ${productContext.average_rating}`;
    banner.style.position = "fixed";
    banner.style.top = "0";
    banner.style.left = "0";
    banner.style.right = "0";
    banner.style.zIndex = "999999";
    banner.style.background = "#232f3e";
    banner.style.color = "#fff";
    banner.style.padding = "8px 16px";
    banner.style.fontSize = "13px";
    banner.style.fontFamily = "Arial, sans-serif";
    banner.style.textAlign = "center";
    banner.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";

    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 8000);
  }

  async function sendProductContextToBackend(productContext, options = {}) {
    try {
      const asin = productContext?.product_id || "UNKNOWN-ASIN";
      const forceResend = Boolean(options.forceResend) || shouldForceResendOnce();

      if (!forceResend && hasAsinBeenPostedInSession(asin)) {
        log(`Skipping backend send for ASIN ${asin} (already sent in this session).`);
        log(
          "Tip: run `sessionStorage.setItem('ai-shopping-agent-force-resend-once','1')` and reload to force one resend."
        );
        return;
      }

      if (forceResend) {
        log(`Force resend enabled for ASIN ${asin}; bypassing duplicate-session guard.`);
      }

      log("Sending product context to backend...");

      const response = await fetch(CONFIG.backendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(productContext),
      });

      if (!response.ok) {
        errorLog("Backend responded with status", response.status);
        return null;
      }

      const data = await response.json();
      markAsinPostedInSession(asin);
      log("Backend response:", data);

      const intelligence = data?.review_intelligence;
      if (intelligence) {
        log("Reliability Score:", intelligence.reliability_score);
        log("Fake Review Risk:", intelligence.fake_review_risk);
        log("Pros:", intelligence.pros);
        log("Cons:", intelligence.cons);
        log("Summary:", intelligence.review_summary);
      }

      return data;
    } catch (err) {
      errorLog("Error calling backend:", err);
      return null;
    }
  }

  async function runAnalysisFlow(options = {}) {
    if (isAnalysisRunning) {
      log("Analysis run ignored because another run is still in progress.");
      return;
    }

    isAnalysisRunning = true;

    try {
      const productContext = await extractProductContext();
      latestProductContext = productContext;

      log("Product Context JSON:", productContext);
      log(
        "Total extracted reviews:",
        Array.isArray(productContext.reviews) ? productContext.reviews.length : 0
      );

      showProductBanner(productContext);

      const asin = productContext.product_id || "UNKNOWN-ASIN";
      const cached = await loadCachedAnalysisForAsin(asin);
      if (cached?.payload?.review_intelligence) {
        renderAnalysisPanel({
          productContext,
          intelligence: cached.payload.review_intelligence,
          source: `cached (${cached.saved_at || "unknown time"})`,
        });
      }

      const data = await sendProductContextToBackend(productContext, {
        forceResend: Boolean(options.forceResend),
      });

      const intelligence = data?.review_intelligence;
      if (intelligence) {
        renderAnalysisPanel({
          productContext,
          intelligence,
          source: "fresh backend",
        });

        await saveCachedAnalysisForAsin(asin, data);
      }
    } finally {
      isAnalysisRunning = false;
    }
  }

  async function runExtractorOnceCoreElementsExist() {
    let attempts = 0;

    const timerId = setInterval(async () => {
      attempts += 1;

      const titleEl = getFirstElement(SELECTORS.title);
      const priceEl = getFirstElement(SELECTORS.price);
      const ratingEl = getFirstElement(SELECTORS.rating);

      if (titleEl && priceEl && ratingEl) {
        clearInterval(timerId);
        await runAnalysisFlow({ trigger: "auto" });
        return;
      }

      if (attempts >= CONFIG.maxAttempts) {
        clearInterval(timerId);
        warn("Could not find core elements after", attempts, "attempts.");
      }
    }, CONFIG.intervalMs);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    runExtractorOnceCoreElementsExist();
  } else {
    window.addEventListener("DOMContentLoaded", runExtractorOnceCoreElementsExist);
  }

  // Expose tiny debug helpers for manual test control from DevTools.
  window.__aiShoppingAgent = {
    clearPostedAsins() {
      sessionStorage.removeItem(CONFIG.sessionPostedAsinsKey);
    },
    forceResendOnce() {
      sessionStorage.setItem(CONFIG.forceResendOnceKey, "1");
    },
    rerunAnalysis() {
      runAnalysisFlow({ forceResend: true, trigger: "manual" });
    },
    clearCachedAnalysis(asin = null) {
      if (!canUseChromeStorageLocal()) return;
      if (asin) {
        chrome.storage.local.remove(getAnalysisCacheKey(asin));
        return;
      }

      chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items || {}).filter((key) =>
          key.startsWith(`${CONFIG.analysisCachePrefix}:`)
        );
        if (keys.length > 0) {
          chrome.storage.local.remove(keys);
        }
      });
    },
  };
})();