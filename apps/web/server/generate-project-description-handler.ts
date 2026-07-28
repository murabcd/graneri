import type { IncomingMessage, ServerResponse } from "node:http";
import { openai } from "@ai-sdk/openai";
import {
	getOpenAiModelProviderOptions,
	PROJECT_DESCRIPTION_MODEL_ID,
} from "@workspace/ai/models";
import {
	PROJECT_DESCRIPTION_CONTEXT_MAX_NOTES,
	PROJECT_DESCRIPTION_CONTEXT_NOTE_TEXT_MAX_LENGTH,
	PROJECT_DESCRIPTION_CONTEXT_NOTE_TITLE_MAX_LENGTH,
	PROJECT_DESCRIPTION_MAX_LENGTH,
	PROJECT_DESCRIPTION_PROJECT_NAME_MAX_LENGTH,
} from "@workspace/ai/project-description-contract";
import {
	buildProjectDescriptionPrompt,
	PROJECT_DESCRIPTION_INSTRUCTIONS,
} from "@workspace/ai/prompts";
import { generateText, Output } from "ai";
import { z } from "zod";
import { admitHostedOpenAiRequest } from "./hosted-openai-admission.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import {
	createServerWideEvent,
	createServerWideEventEmitter,
	recordServerError,
} from "./server-logger.js";

const projectDescriptionRequestSchema = z.object({
	projectName: z
		.string()
		.trim()
		.min(1)
		.max(PROJECT_DESCRIPTION_PROJECT_NAME_MAX_LENGTH),
	currentDescription: z
		.string()
		.max(PROJECT_DESCRIPTION_MAX_LENGTH)
		.default(""),
	notes: z
		.array(
			z.object({
				title: z
					.string()
					.trim()
					.min(1)
					.max(PROJECT_DESCRIPTION_CONTEXT_NOTE_TITLE_MAX_LENGTH),
				text: z
					.string()
					.trim()
					.max(PROJECT_DESCRIPTION_CONTEXT_NOTE_TEXT_MAX_LENGTH),
			}),
		)
		.max(PROJECT_DESCRIPTION_CONTEXT_MAX_NOTES)
		.default([]),
});

const projectDescriptionOutputSchema = z.object({
	description: z.string().trim().min(1).max(PROJECT_DESCRIPTION_MAX_LENGTH),
});

export const handleGenerateProjectDescriptionRequest = async (
	request: IncomingMessage,
	response: ServerResponse,
) => {
	const startedAt = Date.now();
	const wideEvent = createServerWideEvent({
		event: "project_description_generation.request",
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

	const requestBody = projectDescriptionRequestSchema.safeParse(rawRequestBody);
	if (!requestBody.success) {
		wideEvent.outcome = "error";
		wideEvent.status_code = 400;
		wideEvent.error_code = "request_invalid";
		emitWideEvent("error");
		sendJson(response, 400, {
			error: "Valid project context is required.",
		});
		return;
	}

	const { currentDescription, notes, projectName } = requestBody.data;
	wideEvent.has_current_description = Boolean(currentDescription.trim());
	wideEvent.note_count = notes.length;
	wideEvent.project_name_length = projectName.length;

	let description: string;
	try {
		const result = await generateText({
			model: openai(PROJECT_DESCRIPTION_MODEL_ID),
			providerOptions: getOpenAiModelProviderOptions(
				PROJECT_DESCRIPTION_MODEL_ID,
				{
					reasoningEffort: "none",
					safetyIdentifier: admission.safetyIdentifier,
				},
			),
			instructions: PROJECT_DESCRIPTION_INSTRUCTIONS,
			output: Output.object({
				schema: projectDescriptionOutputSchema,
			}),
			prompt: buildProjectDescriptionPrompt({
				currentDescription,
				notes,
				projectName,
			}),
		});
		description = projectDescriptionOutputSchema.parse(
			result.output,
		).description;
	} catch (error) {
		recordServerError({
			error,
			event: wideEvent,
			operation: "project_description_generation",
		});
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "project_description_generation_failed";
		emitWideEvent("error");
		throw error;
	}

	wideEvent.generated_description_length = description.length;
	wideEvent.outcome = "success";
	wideEvent.status_code = 200;
	emitWideEvent("info");
	sendJson(response, 200, { description });
};
