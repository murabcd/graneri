import {
	getConvexRetryAfterSeconds,
	isConvexErrorCode,
} from "./convex-error.mjs";
import { createSafetyIdentifier } from "./safety-identifier.mjs";

export const authorizeOpenAiRequest = async ({ authorize, rateLimitError }) => {
	try {
		const authorization = await authorize();
		return {
			...(authorization.admissionReservationId
				? { admissionReservationId: authorization.admissionReservationId }
				: {}),
			ok: true,
			safetyIdentifier: await createSafetyIdentifier(
				authorization.tokenIdentifier,
			),
		};
	} catch (error) {
		if (isConvexErrorCode(error, "UNAUTHENTICATED")) {
			return {
				error: "Authentication is invalid.",
				errorCode: "authentication_invalid",
				ok: false,
				statusCode: 401,
			};
		}

		if (isConvexErrorCode(error, "AI_RATE_LIMITED")) {
			return {
				error: rateLimitError,
				errorCode: "rate_limited",
				ok: false,
				retryAfterSeconds: getConvexRetryAfterSeconds(error),
				statusCode: 429,
			};
		}

		return {
			error: "Authentication service is unavailable.",
			errorCode: "authentication_service_unavailable",
			ok: false,
			statusCode: 503,
		};
	}
};
