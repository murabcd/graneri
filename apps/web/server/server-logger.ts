import type { IncomingMessage } from "node:http";
import os from "node:os";
import type { getHostedChatSteerTelemetry } from "@workspace/ai/hosted-chat-runtime";
import pino from "pino";

type HostedChatSteerTelemetry = NonNullable<
	ReturnType<typeof getHostedChatSteerTelemetry>
>;

export type ServerWideEvent = {
	active_run_id?: string | null;
	app_connection_count?: number;
	apps_enabled?: boolean;
	assistant_message_id?: string;
	assistant_run_id?: string;
	chat_id?: string | null;
	continue_run_id?: string | null;
	deferred_tool_count?: number;
	duration_ms?: number;
	error_code?: string;
	error_message?: string | null;
	errors?: object[];
	event: string;
	generated_description_length?: number;
	generated_section_count?: number;
	has_current_description?: boolean;
	has_note_context?: boolean;
	has_recipe?: boolean;
	has_speaker?: boolean;
	has_title?: boolean;
	is_steer_route?: boolean;
	language?: string | null;
	local_folder_count?: number;
	local_folder_root_count?: number;
	method?: string;
	mention_count?: number;
	model?: string | null;
	note_count?: number;
	note_text_length?: number;
	openai_processing_ms?: string | null;
	openai_request_id?: string | null;
	openai_status_code?: number;
	outcome?: "error" | "success";
	path?: string;
	project_name_length?: number;
	raw_notes_length?: number;
	reasoning_effort?: string | null;
	replay_queued_message_id?: string | null;
	request_id?: string;
	requested_model?: string | null;
	selected_source_count?: number;
	service_tier?: string | null;
	source?: string | null;
	status_code?: number;
	steer_queued_message_id?: string | null;
	template_name?: string | null;
	template_section_count?: number;
	template_slug?: string | null;
	timestamp: string;
	tool_count?: number;
	transcript_length?: number;
	transcription_language?: string | null;
	trigger?: string | null;
	web_search_enabled?: boolean;
	workspace_id?: string | null;
} & Partial<HostedChatSteerTelemetry>;

export type ServerWideEventLevel = "error" | "info";

const serializeError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return { message: String(error), type: "UnknownError" };
	}

	return {
		message: error.message,
		type: error.name,
	};
};

const serverLogger = pino({
	base: {
		commit_hash: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
		environment:
			process.env.GRANERI_ENV_MODE ?? process.env.NODE_ENV ?? "local",
		instance_id: process.env.VERCEL_DEPLOYMENT_ID ?? os.hostname(),
		region: process.env.VERCEL_REGION ?? "local",
		service: "web-server",
		version: process.env.npm_package_version ?? "0.0.1",
	},
	level: "info",
});

export const createServerWideEvent = ({
	event,
	request,
}: {
	event: string;
	request?: IncomingMessage;
}): ServerWideEvent => ({
	event,
	method: request?.method,
	path: request?.url,
	request_id:
		typeof request?.headers["x-request-id"] === "string"
			? request.headers["x-request-id"]
			: undefined,
	timestamp: new Date().toISOString(),
});

export const recordServerError = <TDetails extends object = object>({
	details,
	error,
	event,
	operation,
}: {
	details?: TDetails;
	error: unknown;
	event: ServerWideEvent;
	operation: string;
}) => {
	event.errors ??= [];
	event.errors.push({
		operation,
		...(details ?? {}),
		error: serializeError(error),
	});
};

export const emitServerWideEvent = ({
	event,
	level = "info",
	startedAt,
}: {
	event: ServerWideEvent;
	level?: ServerWideEventLevel;
	startedAt: number;
}) => {
	event.duration_ms = Date.now() - startedAt;

	if (level === "error") {
		serverLogger.error(event);
		return;
	}

	serverLogger.info(event);
};

export const createServerWideEventEmitter = ({
	beforeEmit,
	event,
	startedAt,
}: {
	beforeEmit?: () => void;
	event: ServerWideEvent;
	startedAt: number;
}) => {
	let emitted = false;

	return (level: ServerWideEventLevel = "info") => {
		if (emitted) {
			return;
		}

		beforeEmit?.();
		emitted = true;
		emitServerWideEvent({ event, level, startedAt });
	};
};
