/**
 * content.js – Scrapes product data from Amazon product pages.
 * Injected programmatically by popup.js when the user activates the extension.
 */

(function () {
  'use strict';

  /**
   * Returns the trimmed text content of the first matching element, or ''.
   * @param {string} selector
   * @param {Document|Element} [root=document]
   */
  function getText(selector, root) {
    const el = (root || document).querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  /**
   * Extracts the ASIN from the current page URL or from a hidden input.
   */
  function getAsin() {
    const match = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (match) return match[1];
    const input = document.querySelector('input#ASIN, input[name="ASIN"]');
    return input ? input.value : '';
  }

  /**
   * Extracts the current price string (e.g. "$24.99").
   */
  function getPrice() {
    // Modern Amazon price block
    const offscreen = document.querySelector(
      '#corePrice_feature_div .a-price .a-offscreen, ' +
      '#price_inside_buybox, ' +
      '#priceblock_ourprice, ' +
      '#priceblock_dealprice, ' +
      '.a-price .a-offscreen'
    );
    if (offscreen) return offscreen.textContent.trim();
    return '';
  }

  /**
   * Extracts up to `max` customer review texts.
   * @param {number} [max=10]
   */
  function getReviews(max) {
    max = max || 10;
    const nodes = document.querySelectorAll('[data-hook="review-body"] span');
    const reviews = [];
    for (let i = 0; i < nodes.length && reviews.length < max; i++) {
      const text = nodes[i].textContent.trim();
      if (text) reviews.push(text);
    }
    return reviews;
  }

  /**
   * Extracts product feature bullets.
   */
  function getFeatures() {
    const items = document.querySelectorAll('#feature-bullets li span.a-list-item');
    return Array.from(items)
      .map(el => el.textContent.trim())
      .filter(t => t.length > 0);
  }

  /**
   * Detects whether this is a supported Amazon product page.
   */
  function isProductPage() {
    return /\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(location.pathname) ||
      !!document.querySelector('#productTitle');
  }

  // Listen for messages from popup.js or service_worker.js
  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message.action !== 'scrape') return;

    if (!isProductPage()) {
      sendResponse({ error: 'not_product_page' });
      return;
    }

    const title = getText('#productTitle');
    const brand = getText('#bylineInfo') || getText('#brand');
    const price = getPrice();
    const rating = getText('#acrPopover .a-icon-alt') ||
                   getText('span[data-asin] .a-icon-alt') ||
                   getText('.a-icon-star .a-icon-alt');
    const reviewCount = getText('#acrCustomerReviewText');
    const features = getFeatures();
    const reviews = getReviews(10);
    const asin = getAsin();
    const url = location.href;

    sendResponse({
      asin,
      title,
      brand,
      price,
      rating,
      reviewCount,
      features,
      reviews,
      url
    });
  });
})();
