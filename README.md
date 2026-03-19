# Purchase Intelligence Brief

An intelligent Chrome extension + Node.js backend system that analyzes Amazon product reviews and provides data-driven purchase recommendations powered by AI.

## Overview

Purchase Intelligence Brief combines a Chrome browser extension with a sophisticated backend API to intelligently summarize product reviews, assess review reliability, and deliver clear purchasing recommendations. The system extracts product information and customer reviews from Amazon pages, processes them through an AI-driven analysis pipeline, and displays actionable insights directly in your browser.

## Key Features

- **Automated Review Analysis**: Extracts and analyzes product reviews directly from Amazon product pages.
- **Review Intelligence**: AI-powered extraction of pros, cons, and comprehensive summaries using Mistral LLM.
- **Reliability Scoring**: Weights reviews by verification status, helpful votes, and consistency with verified purchase patterns.
- **Decision Support**: Delivers clear buy/avoid/consider recommendations with confidence metrics.
- **Multilingual Support**: Automatically detects and normalizes reviews in multiple languages.
- **Performance Optimization**: Caches analysis results per product and handles large review sets with adaptive payload management.
- **Professional UI**: Clean, responsive panel that displays insights without disrupting your shopping experience.

## How It Works

The system works in three stages:

1. **Extraction**: The extension detects when you visit an Amazon product page and extracts:
   - Product information (title, price, rating, features)
   - Customer reviews (up to 150 reviews)

2. **Analysis Pipeline** (Backend):
   - **Review Intelligence Agent**: Uses Mistral LLM to extract pros, cons, and summary.
   - **Reliability Scoring**: Calculates a review reliability score based on verification status, helpful votes, and review consistency.
   - **Quality Guard**: Validates and normalizes the intelligence payload.
   - **Decision Agent**: Generates a purchase recommendation with confidence metrics and red flags.

3. **Display**: Results are cached locally and displayed in a professional panel on the right side of the page.

## Getting Started

### Prerequisites

- **Node.js** 16+ and npm
- **Chrome** or Chromium-based browser (v90+)
- Mistral API key (for LLM functionality)

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd shopping_decision_agent
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   Create a `.env` file in the project root:
   ```bash
   MISTRAL_API_KEY=your_mistral_api_key
   DECISION_LAYER_ENABLED=true
   NODE_ENV=development
   ```

### Running the Backend

Start the backend server:

```bash
# Standard mode (review intelligence only)
npm start

# With decision layer enabled
npm run start:decision
```

The backend server will start on `http://localhost:3000`.

### Installing the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder in this project and select it
5. The extension should now appear in your browser toolbar

### Testing the Extension

1. Navigate to any Amazon product page (e.g., https://www.amazon.com/dp/ASIN)
2. Wait for the "Purchase Intelligence Brief" panel to appear on the right side
3. The extension will automatically analyze reviews and display insights

## Scoring & Recommendation Logic

The recommendation engine employs a multi-layered scoring methodology that synthesizes review quality, product value, and decision confidence. Each component is normalized to a 0-100 scale, with confidence represented as a decimal between 0 and 1. This design ensures recommendations are both data-driven and transparent.

### Overview of the Scoring Pipeline

```
Input Reviews
    ↓
Review Intelligence (LLM Analysis)
    ├─→ Extract: Pros, Cons, Summary
    └─→ Calculate: Sentiment Clusters
    ↓
[1] Reliability Score ────┐
    ├─→ Sample Size       │
    ├─→ Verified Purchases│
    └─→ Consistency Check │
    ↓                     │
[2] Decision Score ←──────┼─────────────────┐
    ├─→ Quality Score    │                 │
    ├─→ Value Score      │                 │
    ├─→ Evidence Score   │                 │
    └─→ Adjustment       │                 │
         Penalties        │                 │
    ↓                     │                 │
[3] Confidence Metric ←───┴─────────────────┘
    ↓
[4] Recommendation (BUY | CONSIDER | AVOID)
```

---

### 1. Reliability Score: Trustworthiness of Review Data

The reliability score measures how much you can trust the review dataset, accounting for verification status, sample size, and rating consistency.

#### Calculation

| Component | Weight | Range | Purpose |
|-----------|--------|-------|---------|
| Sample Score | +40 | 0–40 | Rewards larger review sets |
| Verified Score | +25 | 0–25 | Weights verified purchases |
| Base Score | +30 | - | Starting trustworthiness |
| Consistency Penalty | −20 | 0–20 | Penalizes anomalies |
| Captcha Penalty | −10 | 0/10 | Crowling friction |

```
sample_score = clamp((review_count / 80) × 40, 0, 40)
  └─ Example: 80 reviews → 40 points; 40 reviews → 20 points

verified_score = clamp((verified_count / total_count) × 25, 0, 25)
  └─ Example: 60% verified purchases → 15 points

consistency_penalty = |avg_rating / 5 − high_rating_ratio| × 20
  └─ Detects suspicious patterns (e.g., avg 3.5★ but 90% ≥4★)

reliability_score = clamp(30 + sample_score + verified_score 
                          − consistency_penalty − captcha_penalty, 0, 100)

reliability_confidence = clamp(review_count / 60, 0, 1)
  └─ Confidence grows with sample size; maxes at 60+ reviews
```

**Interpretation:**
- **Score ≥ 75**: Strong review dataset with good verification and consistency
- **Score 50–74**: Moderate trustworthiness; sample size or verification is limited
- **Score < 50**: Weak dataset; caution advised in relying on recommendations

---

### 2. Decision Score: Synthesized Purchase Recommendation

The decision score combines four quality dimensions—product quality, value, evidence sufficiency, and reliability—then applies risk adjustments. This is the primary signal for the final recommendation.

#### Component 2a: Quality Score (0–100)

Measures intrinsic product desirability through rating and review sentiment.

```
quality_score = 0.35 × avg_rating_score
              + 0.20 × volume_score
              + 0.25 × sentiment_score
              + 0.20 × pros_cons_score

where:
  avg_rating_score = (product_average_rating / 5) × 100
    ├─ Example: 4.2★ → 84 points
    
  volume_score = (log₁₀(total_ratings + 1) / log₁₀(5001)) × 100
    ├─ Logarithmic scaling rewards high review volume
    └─ Example: 320 ratings → ~65 points; 5000+ → 100 points
    
  sentiment_score = (positive_clusters × 1.0 
                   + mixed_clusters × 0.5 
                   + negative_clusters × 0.0) / total_clusters × 100
    └─ Example: 70% positive, 20% mixed, 10% negative → 80 points
    
  pros_cons_score = (pros_count / (pros_count + cons_count)) × 100
    └─ Example: 8 pros, 5 cons → 62 points; no pros/cons → 50 points
```

**Weighting Philosophy:**
- Product rating (35%): Direct quality signal
- Review volume (20%): Data credibility via sample size
- Sentiment (25%): LLM-derived opinion synthesis
- Pros/Cons balance (20%): Customer pain-point identification

#### Component 2b: Value Score (0–100)

Evaluates whether the product offers good value relative to price and feature set.

```
value_score = 0.55 × (0.6 × avg_rating + 0.4 × sentiment_score)
            + 0.25 × feature_score
            + 0.20 × (100 − price_pressure)

where:
  feature_score = (feature_count / 12) × 100
    ├─ Normalizes against typical feature richness
    └─ Example: 8 features → 67 points
    
  price_pressure = (log₁₀(price + 1) / 3) × 100
    ├─ Logarithmic scaling: high-price products face pressure
    └─ Example: $199 → ~73 pressure; $1000 → ~100 pressure
    
  value_adjustment = 0.6 × rating + 0.4 × sentiment
    └─ Blends objective rating with subjective sentiment
```

**Interpretation:**
- A product with strong rating/sentiment, rich features, and competitive price scores high
- Expensive items with few features naturally score lower (legitimate trade-off)

#### Component 2c: Evidence Score (0–100)

Assesses how sufficient and reliable the underlying review evidence is.

```
evidence_score = 0.45 × sample_strength
               + 0.25 × usability_ratio × 100
               + 0.20 × dedupe_retention × 100
               + 0.10 × llm_bonus

where:
  sample_strength = (usable_reviews / 60) × 100
    ├─ Capped at 60 usable reviews (diminishing returns)
    └─ Example: 140 usable → 100+ (clamped to 100)
    
  usability_ratio = usable_reviews / input_reviews
    ├─ Percentage of input reviews that passed quality checks
    └─ Example: 140 usable of 150 input → 93%
    
  dedupe_retention = deduped_reviews / usable_reviews
    ├─ Fraction of reviews surviving deduplication
    └─ Example: 120 after dedupe of 140 → 86%
    
  llm_bonus = llm_used ? 100 : 70
    └─ Full points if LLM analysis succeeded; else fallback value
```

**Why This Matters:**
- Evidence quality directly impacts confidence in the final recommendation
- Low usability or high deduplication losses signal data quality issues

#### Component 2d: Raw Decision Score

Synthesizes all three dimensions with balanced weights:

```
raw_score = 0.35 × quality_score
          + 0.25 × value_score
          + 0.25 × reliability_score
          + 0.15 × evidence_score
```

**Weight Rationale:**
- Quality (35%): Primary driver of purchase decision
- Value (25%): Critical for practical buying choice
- Reliability (25%): Ensures scores are trustworthy
- Evidence (15%): Acts as confidence multiplier

#### Component 2e: Adjustment Penalties

Risk factors that reduce the raw score to account for real product limitations:

| Risk Signal | Penalty | Threshold | Meaning |
|---|---|---|---|
| Notable Cons | −6 | usable ≥ 15 AND cons ≥ 5 AND cons ≥ pros + 2 AND negative_ratio ≥ 0.5 | Product has real drawbacks |
| High Negativity | −8 | negative_cluster_ratio ≥ 35% | Strong negative sentiment exists |
| Crawling Friction | −10 | captcha_blocked = true | Data credibility reduced |

```
adjustment_penalties = (notable_cons ? 6 : 0)
                     + (high_negativity ? 8 : 0)
                     + (captcha_blocked ? 10 : 0)

decision_score = clamp(raw_score − adjustment_penalties, 0, 100)
```

---

### 3. Confidence Metric: Certainty of Recommendation (0–1)

Confidence quantifies how much to trust the recommendation. It influences whether a borderline score gets upgraded or downgraded.

```
confidence = 0.40 × reliability_confidence
           + 0.35 × (evidence_score / 100)
           + 0.15 × min(usable_reviews / 20, 1.0)
           + 0.10 × (llm_used ? 1.0 : 0.75)
           − (captcha_blocked ? 0.20 : 0.0)
```

| Factor | Weight | Impact |
|--------|--------|--------|
| Review reliability confidence | 40% | Trust in dataset |
| Evidence quality | 35% | Sufficiency of data |
| Review sample size | 15% | Statistical power (caps at 20 reviews) |
| LLM validity | 10% | Analysis depth |
| Captcha penalty | −20% | Crawler credibility hit |

**Confidence Thresholds:**
- **≥ 0.75**: High confidence → Recommendation is strong
- **0.55–0.75**: Moderate confidence → Recommendation is qualified
- **< 0.55**: Low confidence → Recommendation downgraded to "CONSIDER"

---

### 4. Recommendation Decision Logic

The final recommendation (`BUY`, `CONSIDER`, or `AVOID`) is determined by strict thresholds applied to decision score, confidence, and data sufficiency:

```
decision_state = (usable_reviews ≥ 8 AND evidence_score ≥ 35) 
                 ? "sufficient_data" 
                 : "insufficient_data"

if decision_state == "insufficient_data":
    recommendation = "CONSIDER"  // Conservative default
    
else:
    if decision_score ≥ 72 AND confidence ≥ 0.55:
        recommendation = "BUY"
    else if decision_score < 50:
        recommendation = "AVOID"
    else:
        recommendation = "CONSIDER"
    
    // Final confidence check
    if recommendation == "BUY" AND confidence < 0.55:
        recommendation = "CONSIDER"
```

**Recommendation Interpretation:**
- **BUY**: Strong positive signal; product is recommended with good evidence
- **CONSIDER**: Borderline or uncertain; suitable for further research
- **AVOID**: Significant concerns or negative signals detected

---

### 5. Red Flags and Positive Signals

The system automatically identifies patterns that inform the user of potential concerns or strengths.

#### Red Flags (Displayed as Warnings)
- **Captcha Encountered**: Review crawling encountered anti-bot friction, reducing data credibility
- **Cons Volume Notable**: Product has meaningful drawbacks (cons exceed pros + consistency)
- **Insufficient Evidence**: Too few high-quality reviews to make a confident decision

#### Top Reasons (Displayed as Strengths)
- **Strong Rating**: Average rating ≥ 4.0 (≥80 points)
- **Good Review Reliability**: Reliability score ≥ 70 with strong verification
- **Rich Feature Set**: Feature score ≥ 60 relative to category
- **Positive Pro/Con Balance**: Pros materially outweigh cons
- **Strong Value Signal**: Value score ≥ 65

---

### Worked Example: Smartphone Purchase

**Product Details:**
- Rating: 4.2★ | Reviews: 320 | Price: $199 | Features: 8

**Review Intelligence (LLM Output):**
- Usable reviews: 140 of 150 extracted
- Pros identified: 8 | Cons identified: 5
- Sentiment clusters: 70% positive, 20% mixed, 10% negative
- Reliability score: 78

#### Step 1: Quality Score Calculation

```
avg_rating_score     = (4.2 / 5) × 100 = 84
volume_score         = (log₁₀(321) / log₁₀(5001)) × 100 ≈ 65
sentiment_score      = (70×1 + 20×0.5 + 10×0) = 80
pros_cons_score      = (8 / 13) × 100 ≈ 62

quality_score = 0.35×84 + 0.20×65 + 0.25×80 + 0.20×62
              = 29.4 + 13.0 + 20.0 + 12.4 
              = 74.8 → 74 (rounded)
```

#### Step 2: Value Score Calculation

```
feature_score        = (8 / 12) × 100 ≈ 67
price_pressure       = (log₁₀(200) / 3) × 100 ≈ 73
value_adjustment     = 0.6×84 + 0.4×80 = 82.4

value_score = 0.55×82.4 + 0.25×67 + 0.20×(100−73)
            = 45.32 + 16.75 + 5.4
            = 67.5 → 68 (rounded)
```

#### Step 3: Evidence Score Calculation

```
sample_strength      = (140 / 60) × 100 → clamped to 100
usability_ratio      = (140 / 150) × 100 = 93
dedupe_retention     = (120 / 140) × 100 = 86  (assumed)
llm_bonus            = 100 (LLM succeeded)

evidence_score = 0.45×100 + 0.25×93 + 0.20×86 + 0.10×100
               = 45 + 23.25 + 17.2 + 10
               = 95.45 → 95 (rounded, then clamped to 100)
```

#### Step 4: Raw Decision Score

```
raw_score = 0.35×74 + 0.25×68 + 0.25×78 + 0.15×95
          = 25.9 + 17.0 + 19.5 + 14.25
          = 76.65 → 77

No penalties apply (cons not dominant → no notable cons signal)
decision_score = 77
```

#### Step 5: Confidence Metric

```
reliability_confidence = clamp(140 / 60, 0, 1) = 1.0
evidence_score_norm    = 95 / 100 = 0.95
sample_size_factor     = min(140 / 20, 1.0) = 1.0
llm_factor             = 1.0

confidence = 0.40×1.0 + 0.35×0.95 + 0.15×1.0 + 0.10×1.0
           = 0.40 + 0.3325 + 0.15 + 0.10
           = 0.9825 → 0.98 (clamped to 1.0)
```

#### Step 6: Final Recommendation

```
decision_state = "sufficient_data" ✓
               (140 usable ≥ 8, evidence_score 95 ≥ 35)

decision_score (77) ≥ 72? YES ✓
confidence (0.98) ≥ 0.55? YES ✓

RECOMMENDATION: **BUY**

Display:
├─ Recommendation: BUY
├─ Decision Score: 77/100
├─ Confidence: 98%
├─ Strengths: Strong rating, good reliability, positive pros/cons balance
└─ Concerns: None
```