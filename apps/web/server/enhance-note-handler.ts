import type { IncomingMessage, ServerResponse } from "node:http";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { NOTE_GENERATION_MODEL_ID } from "../../../packages/ai/src/models.mjs";
import {
	buildEnhancedNotePrompt,
	ENHANCED_NOTE_SYSTEM_PROMPT,
} from "../../../packages/ai/src/prompts.mjs";
import {
	authorizeHostedOpenAiRequest,
	getOpenAiSafetyProviderOptions,
	sendHostedOpenAiAdmissionError,
} from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import {
	createServerWideEvent,
	createServerWideEventEmitter,
	recordServerError,
} from "./server-logger.js";

type EnhanceNoteRequestBody = {
	title?: string;
	rawNotes?: string;
	transcript?: string;
	noteText?: string;
};

const structuredNoteSchema = z.object({
	title: z.string().min(1),
	overview: z.array(z.string()),
	sections: z
		.array(
			z.object({
				title: z.string().min(1),
				items: z.array(z.string()).min(1),
			}),
		)
		.min(1),
});

export const handleEnhanceNoteRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "enhance_note.request",
		request,
	});
	const emitWideEvent = createServerWideEventEmitter({
		event: wideEvent,
		startedAt,
	});
	const admission = await authorizeHostedOpenAiRequest({
		operation: "note-generation",
		request,
	});
	if (!admission.ok) {
		wideEvent.outcome = "error";
		wideEvent.status_code = admission.statusCode;
		wideEvent.error_code = admission.errorCode;
		emitWideEvent("error");
		sendHostedOpenAiAdmissionError(response, admission);
		return;
	}

	if (!process.env.OPENAI_API_KEY) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "openai_api_key_missing";
		emitWideEvent("error");
		sendJson(response, 500, {
			error: "OPENAI_API_KEY is not configured.",
		});
		return;
	}

	let requestBody: EnhanceNoteRequestBody;
	try {
		requestBody = await readJsonBody<EnhanceNoteRequestBody>(request);
	} catch (error) {
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
		title = "",
		rawNotes = "",
		transcript = "",
		noteText = "",
	} = requestBody;

	const trimmedTranscript = transcript.trim();
	const trimmedNoteText = noteText.trim();
	wideEvent.raw_notes_length = rawNotes.length;
	wideEvent.transcript_length = trimmedTranscript.length;
	wideEvent.note_text_length = trimmedNoteText.length;
	wideEvent.has_title = Boolean(title.trim());

	if (!trimmedTranscript && !trimmedNoteText) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "source_text_missing";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "Transcript or note text is required.",
		});
		return;
	}

	let output: z.infer<typeof structuredNoteSchema>;
	try {
		const result = await generateText({
			model: openai(NOTE_GENERATION_MODEL_ID),
			providerOptions: getOpenAiSafetyProviderOptions(
				admission.safetyIdentifier,
			),
			system: ENHANCED_NOTE_SYSTEM_PROMPT,
			output: Output.object({
				schema: structuredNoteSchema,
			}),
			prompt: buildEnhancedNotePrompt({
				title,
				rawNotes,
				transcript: trimmedTranscript,
				noteText: trimmedNoteText,
			}),
		});
		output = structuredNoteSchema.parse(result.output);
	} catch (error) {
		recordServerError({
			error,
			event: wideEvent,
			operation: "note_generation",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "note_generation_failed";
		emitWideEvent("error");
		throw error;
	}

	wideEvent.outcome = "success";
	wideEvent.status_code = 200;
	wideEvent.generated_section_count = output.sections.length;
	emitWideEvent("info");
	sendJson(response, 200, {
		note: output,
	});
};
