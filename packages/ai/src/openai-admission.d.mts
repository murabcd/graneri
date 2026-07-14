type OpenAiAdmission =
	| {
			admissionReservationId?: string;
			ok: true;
			safetyIdentifier: string;
	  }
	| {
			error: string;
			errorCode:
				| "authentication_invalid"
				| "authentication_service_unavailable"
				| "rate_limited";
			ok: false;
			retryAfterSeconds?: number;
			statusCode: 401 | 429 | 503;
	  };

export declare const authorizeOpenAiRequest: (args: {
	authorize: () => Promise<{
		admissionReservationId?: string;
		tokenIdentifier: string;
	}>;
	rateLimitError: string;
}) => Promise<OpenAiAdmission>;
