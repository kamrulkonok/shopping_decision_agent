const productContextSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schema.shopping-agent.ai/product-context.schema.json",
  title: "Product Context",
  description:
    "Structured product context extracted from an e-commerce page for AI shopping decision analysis.",
  type: "object",
  required: [
    "product_id",
    "product_title",
    "brand",
    "category",
    "description",
    "price",
    "average_rating",
    "total_ratings",
    "features",
    "reviews",
  ],
  properties: {
    product_id: {
      type: "string",
      description: "Unique product identifier such as Amazon ASIN.",
    },
    product_title: {
      type: "string",
      description: "Full product title displayed on the product page.",
    },
    brand: {
      type: "string",
      description: "Brand or manufacturer of the product.",
    },
    category: {
      type: "string",
      description: "Primary product category.",
    },
    description: {
      type: "string",
      description: "Short description or product summary.",
    },
    price: {
      type: "number",
      minimum: 0,
      description: "Current selling price of the product.",
    },
    currency: {
      type: "string",
      description: "Currency code according to ISO 4217.",
      examples: ["USD", "EUR", "GBP"],
    },
    average_rating: {
      type: "number",
      minimum: 0,
      maximum: 5,
      description: "Average customer rating.",
    },
    total_ratings: {
      type: "integer",
      minimum: 0,
      description: "Total number of ratings received by the product.",
    },
    features: {
      type: "array",
      description: "List of key product features or bullet points.",
      items: {
        type: "string",
      },
    },
    reviews: {
      type: "array",
      description: "List of customer reviews extracted from the product page.",
      items: {
        $ref: "#/$defs/review",
      },
    },
  },
  $defs: {
    review: {
      type: "object",
      description: "Individual product review.",
      required: [
        "review_id",
        "review_title",
        "review_text",
        "review_rating",
        "review_date",
        "verified_purchase",
        "helpful_votes",
      ],
      properties: {
        review_id: {
          type: "string",
          description: "Unique identifier of the review.",
        },
        review_title: {
          type: "string",
          description: "Title or headline of the review.",
        },
        review_text: {
          type: "string",
          description: "Full review text written by the customer.",
        },
        review_rating: {
          type: "number",
          minimum: 0,
          maximum: 5,
          description: "Rating given by the reviewer.",
        },
        review_date: {
          type: "string",
          format: "date",
          description: "Date when the review was posted.",
        },
        verified_purchase: {
          type: "boolean",
          description: "Indicates whether the purchase was verified.",
        },
        helpful_votes: {
          type: "integer",
          minimum: 0,
          description: "Number of users who marked the review as helpful.",
        },
      },
    },
  },
};

const requiredProductFields = productContextSchema.required;
const requiredReviewFields = productContextSchema.$defs.review.required;

function validateRequiredFields(productContext) {
  const missingProductFields = requiredProductFields.filter(
    (field) => productContext[field] === undefined || productContext[field] === null
  );

  const reviews = Array.isArray(productContext.reviews) ? productContext.reviews : [];
  const reviewFieldIssues = [];

  reviews.forEach((review, index) => {
    const missingReviewFields = requiredReviewFields.filter(
      (field) => review[field] === undefined || review[field] === null
    );

    if (missingReviewFields.length > 0) {
      reviewFieldIssues.push({
        review_index: index,
        missing_fields: missingReviewFields,
      });
    }
  });

  return {
    valid: missingProductFields.length === 0 && reviewFieldIssues.length === 0,
    missingProductFields,
    reviewFieldIssues,
  };
}

module.exports = {
  productContextSchema,
  validateRequiredFields,
};
