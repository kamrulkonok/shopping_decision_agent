# shopping_decision_agent

End-to-end Chrome extension + Node backend for product review intelligence and decision support.

## Decision Layer

- The backend now supports a feature-flagged decision layer on `POST /analyze-reviews`.
- Enable it with `DECISION_LAYER_ENABLED=true` in your environment.
- When enabled, the response includes:
	- `review_intelligence` (existing contract)
	- `decision` (`buy|consider|avoid`, score, confidence, reasons, flags)

## Schema Endpoints

- `GET /schema/product-context`
- `GET /schema/review-intelligence`
- `GET /schema/decision`
