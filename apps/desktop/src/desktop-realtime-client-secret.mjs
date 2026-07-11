export const createDesktopRealtimeClientSecret = async ({
	fetchImpl,
	getConvexToken,
	getHostedSiteUrl,
	lang,
	source,
	speaker,
}) => {
	const [baseUrl, convexToken] = await Promise.all([
		getHostedSiteUrl(),
		getConvexToken(),
	]);
	const response = await fetchImpl(
		new URL("/api/realtime-transcription-session", baseUrl),
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${convexToken}`,
				"Content-Type": "application/json",
				Origin: new URL(baseUrl).origin,
			},
			body: JSON.stringify({ lang, source, speaker }),
		},
	);
	const payload = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(
			payload?.error || "Failed to create realtime transcription session.",
		);
	}

	const clientSecret = payload?.clientSecret;
	if (!clientSecret || typeof clientSecret !== "string") {
		throw new Error("OpenAI did not return a realtime client secret.");
	}

	return clientSecret;
};
