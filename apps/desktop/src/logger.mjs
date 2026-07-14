import os from "node:os";
import { finished } from "node:stream/promises";
import pino from "pino";
import { createRotatingLogFileStream } from "./desktop-log-file.mjs";

const DESKTOP_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DESKTOP_LOG_RETAINED_FILES = 3;

const createDesktopLoggerBase = ({ version } = {}) => ({
	commit_hash: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
	environment: process.env.GRANERI_ENV_MODE ?? process.env.NODE_ENV ?? "local",
	instance_id: os.hostname(),
	region: process.env.VERCEL_REGION ?? "local",
	service: "desktop",
	version: version ?? process.env.npm_package_version ?? "0.1.0",
});

const normalizeMessage = ({ fallback, message }) => {
	if (typeof message !== "string") {
		return fallback;
	}

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

export const serializeError = (error) => {
	if (error && typeof error === "object" && !(error instanceof Error)) {
		return error;
	}

	if (!(error instanceof Error)) {
		return { message: String(error), type: "UnknownError" };
	}

	return {
		message: error.message,
		stack: error.stack,
		type: error.name,
	};
};

const normalizeEvent = ({ defaultEvent, event }) => {
	const { event: explicitEvent, ...details } = event;

	return {
		...details,
		event:
			explicitEvent ??
			normalizeMessage({
				fallback: defaultEvent,
				message: event.message,
			}),
	};
};

const isTestProcess = () =>
	process.env.NODE_ENV === "test" ||
	process.argv.some((argument) => argument.includes("/tests/"));

const createDesktopLogger = ({ fileStream, version } = {}) => {
	const options = {
		base: createDesktopLoggerBase({ version }),
		level: isTestProcess() ? "silent" : "info",
	};

	if (!fileStream || isTestProcess()) {
		return pino(options);
	}

	return pino(
		options,
		pino.multistream([{ stream: process.stdout }, { stream: fileStream }]),
	);
};

let logger = null;
let desktopFileStream = null;

const getLogger = () => {
	logger ??= createDesktopLogger();
	return logger;
};

export const initializeDesktopFileLogging = ({ logFilePath, version }) => {
	if (desktopFileStream) {
		throw new Error("Desktop file logging has already been initialized.");
	}

	desktopFileStream = createRotatingLogFileStream({
		filePath: logFilePath,
		maxBytes: DESKTOP_LOG_MAX_BYTES,
		retainedFiles: DESKTOP_LOG_RETAINED_FILES,
	});
	logger = createDesktopLogger({ fileStream: desktopFileStream, version });
};

export const stopDesktopFileLogging = async () => {
	if (!desktopFileStream) {
		return;
	}

	const fileStream = desktopFileStream;
	desktopFileStream = null;
	logger = createDesktopLogger();
	fileStream.end();
	await finished(fileStream);
};

export const logInfo = (event) => {
	getLogger().info(normalizeEvent({ defaultEvent: "desktop.info", event }));
};

export const logError = ({ error, ...event }) => {
	getLogger().error({
		...normalizeEvent({ defaultEvent: "desktop.error", event }),
		error: error === undefined ? undefined : serializeError(error),
	});
};

export const createWideEvent = ({ event, request }) => ({
	event,
	method: request?.method,
	path: request?.url,
	timestamp: new Date().toISOString(),
});

export const recordWideEventError = ({
	details = {},
	error,
	event,
	operation,
}) => {
	event.errors ??= [];
	event.errors.push({
		operation,
		...details,
		error: serializeError(error),
	});
};

export const emitWideEvent = ({ event, level = "info", startedAt }) => {
	event.duration_ms = Date.now() - startedAt;

	if (level === "error") {
		getLogger().error(event);
		return;
	}

	getLogger().info(event);
};
