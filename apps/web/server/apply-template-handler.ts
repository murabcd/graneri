import type { IncomingMessage, ServerResponse } from "node:http";
import { openai } from "@ai-sdk/openai";
import {
	getOpenAiModelProviderOptions,
	NOTE_GENERATION_MODEL_ID,
} from "@workspace/ai/models";
import {
	APPLY_TEMPLATE_INSTRUCTIONS,
	buildApplyTemplatePrompt,
} from "@workspace/ai/prompts";
import { generateText } from "ai";
import {
	parseTemplateStreamToStructuredNote,
	validateTemplateStream,
} from "../src/lib/note-template-stream.js";
import { parseTranscriptionLanguageInput } from "../src/lib/transcription-languages.js";
import { admitHostedOpenAiRequest } from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import {
	createServerWideEvent,
	createServerWideEventEmitter,
	recordServerError,
} from "./server-logger.js";

type ApplyTemplateRequestBody = {
	title?: string;
	noteText?: string;
	transcriptionLanguage?: unknown;
	transcript?: string;
	template?: {
		slug?: string;
		name?: string;
		meetingContext?: string;
		sections?: Array<{
			id?: string;
			title?: string;
			prompt?: string;
		}>;
	};
};

class ApplyTemplateRequestError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);
		this.statusCode = statusCode;
	}
}

const getApplyTemplatePayload = async (request: IncomingMessage) => {
	const {
		title = "",
		noteText = "",
		transcriptionLanguage: rawTranscriptionLanguage,
		transcript = "",
		template,
	} = await readJsonBody<ApplyTemplateRequestBody>(request);

	if (!noteText.trim()) {
		throw new ApplyTemplateRequestError("Note text is required.", 400);
	}

	if (!template?.name || !template.sections || template.sections.length === 0) {
		throw new ApplyTemplateRequestError("A valid template is required.", 400);
	}

	const templateSections = template.sections.flatMap((section) => {
		const title = section.title?.trim() ?? "";
		return title
			? [
					{
						title,
						prompt: section.prompt?.trim() ?? "",
					},
				]
			: [];
	});

	if (templateSections.length === 0) {
		throw new ApplyTemplateRequestError(
			"The selected template does not have usable sections.",
			400,
		);
	}
	let transcriptionLanguage: string | null;
	try {
		transcriptionLanguage = parseTranscriptionLanguageInput(
			rawTranscriptionLanguage,
		);
	} catch (error) {
		throw new ApplyTemplateRequestError(
			error instanceof Error
				? error.message
				: "Invalid transcription language.",
			400,
		);
	}

	return {
		noteText,
		template,
		templateSections,
		title,
		transcript: transcript.trim(),
		transcriptionLanguage,
	};
};

export const handleApplyTemplateRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "apply_template.request",
		request,
	});
	const emitWideEvent = createServerWideEventEmitter({
		event: wideEvent,
		startedAt,
	});
	const admission = await admitHostedOpenAiRequest({
		operation: "note-generation",
		request,
		response,
		onRejected: ({ errorCode, statusCode }) => {
			wideEvent.outcome = "error";
			wideEvent.status_code = statusCode;
			wideEvent.error_code = errorCode;
			emitWideEvent("error");
		},
	});
	if (!admission) {
		return;
	}

	let payload: Awaited<ReturnType<typeof getApplyTemplatePayload>>;
	try {
		payload = await getApplyTemplatePayload(request);
	} catch (error) {
		if (error instanceof ApplyTemplateRequestError) {
			wideEvent.outcome = "error";
			wideEvent.status_code = error.statusCode;
			wideEvent.error_code = "invalid_request";
			emitWideEvent("error");
			sendJson(response, error.statusCode, {
				error: error.message,
			});
			return;
		}

		recordServerError({
			error,
			event: wideEvent,
			operation: "request_parse",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "request_parse_failed";
		emitWideEvent("error");
		throw error;
	}

	const {
		title,
		noteText,
		template,
		templateSections,
		transcript,
		transcriptionLanguage,
	} = payload;
	wideEvent.template_slug = template.slug ?? null;
	wideEvent.template_name = template.name ?? null;
	wideEvent.template_section_count = templateSections.length;
	wideEvent.note_text_length = noteText.length;
	wideEvent.transcript_length = transcript.length;
	wideEvent.has_title = Boolean(title.trim());
	wideEvent.transcription_language = transcriptionLanguage;

	response.statusCode = 200;
	response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
	response.setHeader("Cache-Control", "no-cache, no-transform");
	response.flushHeaders?.();

	const writeEvent = (payload: Record<string, unknown>) => {
		response.write(`${JSON.stringify(payload)}\n`);
	};

	try {
		const result = await generateText({
			model: openai(NOTE_GENERATION_MODEL_ID),
			providerOptions: getOpenAiModelProviderOptions(NOTE_GENERATION_MODEL_ID, {
				reasoningEffort: "none",
				safetyIdentifier: admission.safetyIdentifier,
			}),
			instructions: APPLY_TEMPLATE_INSTRUCTIONS,
			prompt: buildApplyTemplatePrompt({
				title,
				templateName: template.name,
				meetingContext: template.meetingContext,
				templateSections,
				noteText,
				transcript,
				transcriptionLanguage,
			}),
		});
		const rewrittenText = result.text;

		const parsed = parseTemplateStreamToStructuredNote({
			text: rewrittenText,
			template: {
				sections: templateSections,
			},
			isFinal: true,
		});
		const validationError = validateTemplateStream({
			template: {
				sections: templateSections,
			},
			parsed,
		});

		if (validationError) {
			wideEvent.outcome = "error";
			wideEvent.status_code = 422;
			wideEvent.error_code = "template_stream_validation_failed";
			emitWideEvent("error");
			writeEvent({
				type: "error",
				error: validationError,
			});
			response.end();
			return;
		}

		writeEvent({
			type: "text-delta",
			delta: rewrittenText,
		});
		writeEvent({
			type: "final-note",
			note: parsed.note,
		});
		wideEvent.outcome = "success";
		wideEvent.status_code = 200;
		emitWideEvent("info");
		response.end();
	} catch (error) {
		recordServerError({
			error,
			event: wideEvent,
			operation: "template_stream",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "template_stream_failed";
		emitWideEvent("error");
		const message =
			error instanceof Error
				? error.message
				: "Failed to apply note template rewrite.";
		writeEvent({
			type: "error",
			error: message,
		});
		response.end();
	}
};
