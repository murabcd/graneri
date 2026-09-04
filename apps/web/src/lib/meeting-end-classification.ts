import type {
	MeetingEndClassificationRequest,
	MeetingEndClassificationResponse,
} from "@workspace/ai/meeting-end-classification";
import { z } from "zod";
import { getCachedConvexToken } from "@/lib/convex-token";
import { logInfo } from "@/lib/logger";
import { getHostedApiUrl } from "@/lib/runtime-config";

const meetingEndResponseSchema = z.object({
	ended: z.boolean(),
});

type MeetingEndClassificationFetch = typeof fetch;

export const requestMeetingEndClassification = async (
	body: MeetingEndClassificationRequest,
	{
		fetcher = fetch,
		resolveConvexToken = getCachedConvexToken,
	}: {
		fetcher?: MeetingEndClassificationFetch;
		resolveConvexToken?: typeof getCachedConvexToken;
	} = {},
): Promise<MeetingEndClassificationResponse> => {
	const convexToken = await resolveConvexToken();
	if (!convexToken) {
		throw new Error("Authentication is required.");
	}

	const response = await fetcher(getHostedApiUrl("classifyMeetingEnd"), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${convexToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const rawPayload: unknown = await response.json().catch(() => null);

	logInfo({
		event: "meeting_end_classification.renderer_response",
		ok: response.ok,
		status: response.status,
	});

	if (!response.ok) {
		const errorPayload = z.object({ error: z.string() }).safeParse(rawPayload);
		throw new Error(
			errorPayload.success
				? errorPayload.data.error
				: "Failed to classify the meeting end.",
		);
	}

	return meetingEndResponseSchema.parse(rawPayload);
};
