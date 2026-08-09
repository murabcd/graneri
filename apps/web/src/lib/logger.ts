import pino from "pino";

export type LogLevel = "error" | "info";

export type LogEvent = {
	event: string;
	message?: string;
};

const getEnvironmentContext = () => ({
	commit_hash: import.meta.env.VITE_COMMIT_HASH ?? "local",
	environment: import.meta.env.MODE,
	region: import.meta.env.VITE_REGION ?? "local",
	service: "web",
	version: import.meta.env.VITE_APP_VERSION ?? "0.0.1",
});

const serializeError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return { message: String(error), type: "UnknownError" };
	}

	return {
		message: error.message,
		stack: error.stack,
		type: error.name,
	};
};

const logger = pino({
	base: getEnvironmentContext(),
	browser: {
		asObject: true,
	},
	level: import.meta.env.MODE === "test" ? "silent" : "info",
});

const toEventName = (message: string, fallback: string) => {
	const isFailure = /^Failed(\s+to)?\s+/i.test(message);
	const base = message
		.replace(/^\[[^\]]+\]\s*/, "")
		.replace(/^Failed\s+to\s+/i, "")
		.replace(/^Failed\s+/i, "")
		.replace(/\.$/, "")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();

	if (!base) {
		return fallback;
	}

	return isFailure ? `${base}_failed` : base;
};

const normalizeEvent = <TEvent extends LogEvent>(event: TEvent) => {
	if (
		(event.event === "client.error" || event.event === "client.info") &&
		typeof event.message === "string"
	) {
		return {
			...event,
			event: toEventName(event.message, event.event),
		};
	}

	return event;
};

export const logInfo = <TEvent extends LogEvent>(event: TEvent) => {
	logger.info(normalizeEvent(event));
};

export const logError = <TEvent extends LogEvent & { error?: unknown }>(
	event: TEvent,
) => {
	const { error, ...details } = normalizeEvent(event);

	logger.error({
		...details,
		error: error === undefined ? undefined : serializeError(error),
	});
};
