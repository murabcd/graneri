import { describe, expect, it } from "vitest";
import {
	type AutomationToolInput,
	createAutomationMutationInputNormalizer,
} from "../src/automation-tools.mjs";

const automation: AutomationToolInput = {
	title: "Daily summary",
	prompt: "Summarize the note",
	model: "gpt-5.6-luna",
	reasoningEffort: "low",
	webSearchEnabled: false,
	appsEnabled: true,
	appSources: [
		{
			id: "source-1",
			label: "Drive",
			provider: "google-drive",
		},
	],
	schedule: {
		kind: "recurring",
		rrule: "FREQ=DAILY",
		startsAt: "2026-07-20T09:00:00",
		timezone: "Europe/Moscow",
	},
	destination: "current_chat",
	deliveryPolicy: "failed_runs_only",
	stopCondition: "Stop after the report is complete",
	target: {
		kind: "notes",
		label: "Selected notes",
		noteIds: ["note-1", "note-2"],
	},
	chatId: "chat-1",
};

const mutationInput = createAutomationMutationInputNormalizer({
	toAutomationId: (automationId: string) => `automation:${automationId}`,
	toNoteId: (noteId: string) => `note:${noteId}`,
});

describe("automation mutation input normalization", () => {
	it("normalizes create inputs for a transport adapter", () => {
		expect(mutationInput.create(automation)).toEqual({
			...automation,
			appSources: automation.appSources,
			target: {
				kind: "notes",
				noteIds: ["note:note-1", "note:note-2"],
			},
		});
	});

	it("emits only fields accepted by update mutations", () => {
		const input = mutationInput.update({
			...automation,
			automationId: "automation-1",
		});

		expect(input).toEqual({
			automationId: "automation:automation-1",
			title: automation.title,
			prompt: automation.prompt,
			model: automation.model,
			reasoningEffort: automation.reasoningEffort,
			webSearchEnabled: automation.webSearchEnabled,
			appsEnabled: automation.appsEnabled,
			appSources: automation.appSources,
			schedule: automation.schedule,
			deliveryPolicy: automation.deliveryPolicy,
			stopCondition: automation.stopCondition,
			target: {
				kind: "notes",
				noteIds: ["note:note-1", "note:note-2"],
			},
		});
		expect(input).not.toHaveProperty("destination");
		expect(input).not.toHaveProperty("chatId");
	});

	it("normalizes standalone automation ids", () => {
		expect(mutationInput.automationId("automation-1")).toBe(
			"automation:automation-1",
		);
	});

	it("rejects unsupported app source providers", () => {
		expect(() =>
			mutationInput.create({
				...automation,
				appSources: [
					{
						id: "source-1",
						label: "Unknown",
						provider: "unsupported-provider",
					},
				],
			}),
		).toThrow();
	});
});
