# Shopping Decision Agent

An AI-powered Chrome Extension that helps you make smarter purchase decisions on Amazon by analysing product reviews, detecting fakes, comparing alternatives, and predicting price drops – all inside a clean popup panel.

---

## Features

| Feature | Description |
|---|---|
| **Reliability Score** | AI rates the product 0–10 based on reviews and features |
| **Pros & Cons** | Concise bullet-point summary of what buyers love and dislike |
| **Fake Review Detection** | Estimates the percentage of suspicious reviews with a risk level |
| **Price Drop Prediction** | Predicts whether the price is likely to fall soon |
| **Competitor Alternatives** | Suggests 3 comparable products worth considering |

---

## Requirements

- Google Chrome (or any Chromium-based browser that supports Manifest V3)
- An [OpenAI API key](https://platform.openai.com/api-keys) (uses `gpt-4o-mini` by default)

---

## Installation

1. **Clone or download** this repository.

2. Open Chrome and go to `chrome://extensions`.

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **Load unpacked** and select the root folder of this repository
   (`shopping_decision_agent/`).

5. The 🛒 Shopping Decision Agent icon will appear in your toolbar.

---

## Configuration

1. Click the extension icon and then **⚙️** (Settings), or right-click the icon
   and choose **Options**.

2. Paste your OpenAI API key (starts with `sk-`) and click **Save**.

Your key is stored locally with `chrome.storage.sync` and is never sent anywhere
except directly to OpenAI's API.

---

## Usage

1. Go to any Amazon product page
   (e.g. `https://www.amazon.com/dp/B09XYZ1234`).

2. Click the **Shopping Decision Agent** toolbar icon.

3. The popup automatically scrapes the page and calls the AI.
   Analysis usually completes in **5–10 seconds**.

4. Review the panel:
   - **Reliability score** (colour-coded circle)
   - **Pros / Cons** cards
   - **Fake review risk** bar
   - **Price drop likelihood** badge
   - **Competitor products** list

5. Click **🔄 Re-analyse** to force a fresh analysis (bypasses the session cache).

---

## Supported Stores

- amazon.com
- amazon.co.uk
- amazon.ca
- amazon.de
- amazon.fr
- amazon.co.jp
- amazon.in
- amazon.com.au

---

## Project Structure

```
shopping_decision_agent/
├── manifest.json               # Chrome Extension Manifest V3
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html              # Extension popup UI
│   ├── popup.css               # Popup styles
│   └── popup.js                # Popup logic & rendering
├── content/
│   └── content.js              # Injected into Amazon pages to scrape data
├── background/
│   └── service_worker.js       # Handles OpenAI API calls & session caching
└── options/
    ├── options.html            # API key settings page
    ├── options.css
    └── options.js
```

---

## Privacy

- The extension only activates when you click the toolbar icon on a product page.
- No data is collected or stored by this extension beyond your local browser storage.
- Product details and reviews are sent to OpenAI for analysis under
  [OpenAI's Privacy Policy](https://openai.com/policies/privacy-policy).

---

## License

MIT

