const BACKEND_REQUEST_TYPE = "AI_SHOPPING_AGENT_BACKEND_REQUEST";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || message.type !== BACKEND_REQUEST_TYPE) {
		return false;
	}

	const { url, method = "POST", headers = {}, body } = message;

	if (!url) {
		sendResponse({ ok: false, error: "Missing backend URL." });
		return false;
	}

	fetch(url, {
		method,
		headers,
		body,
	})
		.then(async (response) => {
			const rawText = await response.text();
			let parsed = null;

			if (rawText) {
				try {
					parsed = JSON.parse(rawText);
				} catch {
					parsed = null;
				}
			}

			sendResponse({
				ok: response.ok,
				status: response.status,
				data: parsed,
				rawText,
			});
		})
		.catch((error) => {
			sendResponse({
				ok: false,
				error: error.message || "Failed to fetch from backend.",
			});
		});

	return true;
});
