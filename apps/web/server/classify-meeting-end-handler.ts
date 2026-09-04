import type { IncomingMessage, ServerResponse } from "node:http";
import { openai } from "@ai-sdk/openai";
import {
	buildMeetingEndClassificationPrompt,
	MEETING_END_CLASSIFICATION_INSTRUCTIONS,
	MEETING_END_TRANSCRIPT_MAX_CHARACTERS,
	MEETING_END_TRANSCRIPT_MAX_WORDS,
} from "@workspace/ai/meeting-end-classification";
import {
	getOpenAiModelProviderOptions,
	MEETING_END_CLASSIFICATION_MODEL_ID,
} from "@workspace/ai/models";
import { generateText, Output } from "ai";
import { z } from "zod";
import { admitHostedOpenAiRequest } from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import {
	createServerWideEvent,
	createServerWideEventEmitter,
	recordServerError,
} from "./server-logger.js";

const transcriptWordPattern = /\S+/gu;

const meetingEndRequestSchema = z.object({
	transcript: z
		.string()
		.trim()
		.min(1)
		.max(MEETING_END_TRANSCRIPT_MAX_CHARACTERS),
});

const meetingEndOutputSchema = z.object({
	ended: z.boolean(),
});

const countWords = (value: string) =>
	value.match(transcriptWordPattern)?.length ?? 0;

export const handleClassifyMeetingEndRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "meeting_end_classification.request",
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

	let rawRequestBody: unknown;
	try {
		rawRequestBody = await readJsonBody<unknown>(request);
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

	const requestBody = meetingEndRequestSchema.safeParse(rawRequestBody);
	const transcriptWordCount = requestBody.success
		? countWords(requestBody.data.transcript)
		: 0;
	if (
		!requestBody.success ||
		transcriptWordCount > MEETING_END_TRANSCRIPT_MAX_WORDS
	) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "request_invalid";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: `A final transcript of at most ${MEETING_END_TRANSCRIPT_MAX_WORDS} words is required.`,
		});
		return;
	}

	const transcript = requestBody.data.transcript;
	wideEvent.transcript_length = transcript.length;
	wideEvent.transcript_word_count = transcriptWordCount;

	let ended: boolean;
	try {
		const result = await generateText({
			model: openai(MEETING_END_CLASSIFICATION_MODEL_ID),
			providerOptions: getOpenAiModelProviderOptions(
				MEETING_END_CLASSIFICATION_MODEL_ID,
				{
					reasoningEffort: "none",
					safetyIdentifier: admission.safetyIdentifier,
				},
			),
			instructions: MEETING_END_CLASSIFICATION_INSTRUCTIONS,
			output: Output.object({ schema: meetingEndOutputSchema }),
			prompt: buildMeetingEndClassificationPrompt(transcript),
		});
		ended = meetingEndOutputSchema.parse(result.output).ended;
	} catch (error) {
		recordServerError({
			error,
			event: wideEvent,
			operation: "meeting_end_classification",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "meeting_end_classification_failed";
		emitWideEvent("error");
		throw error;
	}

	wideEvent.meeting_ended = ended;
	wideEvent.outcome = "success";
	wideEvent.status_code = 200;
	emitWideEvent("info");
	sendJson(response, 200, { ended });
};
