export const createDesktopDictationTranscription =
	({ getConvexToken, getLocalApiOrigin, fetchImpl = fetch }) =>
	async ({ audio }) => {
		const [convexToken, localApiOrigin] = await Promise.all([
			getConvexToken(),
			getLocalApiOrigin(),
		]);
		const response = await fetchImpl(
			new URL("/api/dictation-transcription", localApiOrigin),
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${convexToken}`,
					"Content-Type": "audio/wav",
					Origin: new URL(localApiOrigin).origin,
				},
				body: audio,
			},
		);
		const payload = await response.json().catch(() => ({}));

		if (
			!response.ok ||
			typeof payload.text !== "string" ||
			!Array.isArray(payload.languages) ||
			payload.languages.some((language) => typeof language !== "string")
		) {
			throw new Error(payload.error || "Unable to transcribe audio.");
		}

		return {
			durationInSeconds: payload.durationInSeconds ?? null,
			languages: payload.languages,
			text: payload.text,
		};
	};
