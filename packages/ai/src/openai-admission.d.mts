type OpenAiAdmission<TAdmissionReservationId extends string> =
	| {
			admissionReservationId?: TAdmissionReservationId;
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

export declare const authorizeOpenAiRequest: <
	TAdmissionReservationId extends string = string,
>(args: {
	authorize: () => Promise<{
		admissionReservationId?: TAdmissionReservationId;
		tokenIdentifier: string;
	}>;
	rateLimitError: string;
}) => Promise<OpenAiAdmission<TAdmissionReservationId>>;
