
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
	productContextSchema,
	validateRequiredFields,
} = require("./schemas/productContextSchema");
const {
	reviewIntelligenceSchema,
	validateReviewIntelligencePayload,
} = require("./schemas/reviewIntelligenceSchema");
const {
	runReviewIntelligenceOrchestrator,
} = require("./orchestrators/reviewIntelligenceOrchestrator");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
	cors({
		origin: "*",
	})
);

app.get("/health", (req, res) => {
	res.json({ status: "ok" });
});

app.get("/schema/product-context", (req, res) => {
	res.json(productContextSchema);
});

app.get("/schema/review-intelligence", (req, res) => {
	res.json(reviewIntelligenceSchema);
});

app.post("/analyze-product", (req, res) => {
	const payload = req.body || {};
	const validation = validateRequiredFields(payload);

	if (!validation.valid) {
		return res.status(400).json({
			ok: false,
			error: "Payload does not satisfy required Product Context fields.",
			missing_product_fields: validation.missingProductFields,
			review_field_issues: validation.reviewFieldIssues,
		});
	}

	console.log("[Backend] Received product context:", {
		product_id: payload.product_id,
		product_title: payload.product_title,
		price: payload.price,
		average_rating: payload.average_rating,
		total_ratings: payload.total_ratings,
		features_count: Array.isArray(payload.features) ? payload.features.length : 0,
		reviews_count: Array.isArray(payload.reviews) ? payload.reviews.length : 0,
	});

	// Step 1 response: acknowledge context ingestion and return a tiny summary.
	const message = `Context captured for ${
		payload.product_title || "(unknown product)"
	}. Features: ${Array.isArray(payload.features) ? payload.features.length : 0}, Reviews: ${
		Array.isArray(payload.reviews) ? payload.reviews.length : 0
	}.`;

	res.json({
		ok: true,
		step: "product-context-extractor",
		message,
	});
});

app.post("/analyze-reviews", async (req, res) => {
	const payload = req.body || {};
	const validation = validateRequiredFields(payload);

	if (!validation.valid) {
		return res.status(400).json({
			ok: false,
			code: "INVALID_PRODUCT_CONTEXT",
			message: "Payload does not satisfy required Product Context fields.",
			details: {
				missing_product_fields: validation.missingProductFields,
				review_field_issues: validation.reviewFieldIssues,
			},
		});
	}

	try {
		const reviewIntelligence = await runReviewIntelligenceOrchestrator(payload);
		const reviewValidation = validateReviewIntelligencePayload(reviewIntelligence);

		if (!reviewValidation.valid) {
			return res.status(500).json({
				ok: false,
				code: "INVALID_REVIEW_INTELLIGENCE",
				message: "Generated review intelligence payload is missing required fields.",
				details: {
					missing_fields: reviewValidation.missingFields,
				},
			});
		}

		res.json({
			ok: true,
			step: "review-intelligence",
			product_id: payload.product_id,
			review_intelligence: reviewIntelligence,
		});
	} catch (error) {
		res.status(500).json({
			ok: false,
			code: "REVIEW_INTELLIGENCE_ERROR",
			message: "Failed to analyze reviews.",
			details: {
				error: error.message,
			},
		});
	}
});

app.listen(PORT, () => {
	console.log(`[Backend] Server listening on http://localhost:${PORT}`);
});

