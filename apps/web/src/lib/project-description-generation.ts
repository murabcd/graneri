import {
	type GenerateProjectDescriptionRequest,
	PROJECT_DESCRIPTION_MAX_LENGTH,
} from "@workspace/ai/project-description-contract";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logInfo } from "@/lib/logger";
import { getHostedApiUrl } from "@/lib/runtime-config";

type ProjectDescriptionFetch = typeof fetch;

export const requestGeneratedProjectDescription = async (
	body: GenerateProjectDescriptionRequest,
	{
		fetcher = fetch,
		resolveConvexToken = getCachedConvexToken,
	}: {
		fetcher?: ProjectDescriptionFetch;
		resolveConvexToken?: typeof getCachedConvexToken;
	} = {},
) => {
	const convexToken = await resolveConvexToken();
	if (!convexToken) {
		throw new Error("Authentication is required.");
	}

	const response = await fetcher(
		getHostedApiUrl("generateProjectDescription"),
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${convexToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);
	const payload = (await response.json().catch(() => ({}))) as {
		description?: unknown;
		error?: string;
	};

	logInfo({
		event: "project_description_generation.renderer_response",
		ok: response.ok,
		status: response.status,
	});

	if (!response.ok) {
		throw new Error(payload.error || "Failed to generate project description.");
	}

	const description =
		typeof payload.description === "string" ? payload.description.trim() : "";
	if (!description || description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
		throw new Error("Generated project description is invalid.");
	}

	return description;
};
