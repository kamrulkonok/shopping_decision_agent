
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
	decisionSchema,
	validateDecisionPayload,
} = require("./schemas/decisionSchema");
const {
	runReviewIntelligenceOrchestrator,
} = require("./orchestrators/reviewIntelligenceOrchestrator");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
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

app.get("/schema/decision", (req, res) => {
	res.json(decisionSchema);
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
		const analysisResult = await runReviewIntelligenceOrchestrator(payload);
		const reviewIntelligence = analysisResult.review_intelligence;
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

		const response = {
			ok: true,
			step: "review-intelligence",
			product_id: payload.product_id,
			review_intelligence: reviewIntelligence,
		};

		if (analysisResult.decision) {
			const decisionValidation = validateDecisionPayload(analysisResult.decision);

			if (!decisionValidation.valid) {
				return res.status(500).json({
					ok: false,
					code: "INVALID_DECISION_PAYLOAD",
					message: "Generated decision payload is missing required fields.",
					details: {
						missing_fields: decisionValidation.missingFields,
					},
				});
			}

			response.decision = analysisResult.decision;
		}

		if (analysisResult.decision_unavailable) {
			response.decision_unavailable = analysisResult.decision_unavailable;
		}

		res.json(response);
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

