import { describe, expect, it } from "vitest";
import { deriveFallbackChatTitle } from "../src/chat-titles.mjs";
import {
	buildApplyTemplatePrompt,
	buildChatInstructions,
	buildEnhancedNotePrompt,
	buildProjectDescriptionPrompt,
} from "../src/prompts.mjs";

describe("prompt helpers", () => {
	it("skips nullable user profile fields in the chat instructions", () => {
		expect(() =>
			buildChatInstructions({
				userProfileContext: {
					name: null,
					jobTitle: null,
					companyName: null,
				},
			}),
		).not.toThrow();
	});

	it("accepts nullable note fields in note prompts", () => {
		expect(() =>
			buildEnhancedNotePrompt({
				title: null,
				rawNotes: null,
				transcript: null,
				noteText: null,
			}),
		).not.toThrow();
		expect(() =>
			buildApplyTemplatePrompt({
				title: null,
				templateName: null,
				meetingContext: null,
				templateSections: [],
				noteText: null,
			}),
		).not.toThrow();
	});

	it("uses the original transcript as the template rewrite language authority", () => {
		const prompt = buildApplyTemplatePrompt({
			transcript: "We reviewed the launch plan and assigned the next steps.",
			templateName: "Weekly team meeting",
			templateSections: [{ title: "Updates" }],
			noteText: "Revisamos el plan de lanzamiento.",
			transcriptionLanguage: "en",
		});

		expect(prompt).toContain(
			"Original transcript (authoritative for output language and source facts)",
		);
		expect(prompt).toContain(
			"Determine the output language only from this transcript.",
		);
		expect(prompt).toContain("Required output language: en");
	});

	it("pins enhanced notes to the live transcription language", () => {
		const prompt = buildEnhancedNotePrompt({
			transcript: "We reviewed the launch plan.",
			transcriptionLanguage: "en",
		});

		expect(prompt).toContain("Required output language: en");
		expect(prompt).toContain(
			"This is the language selected for live transcription.",
		);
	});

	it("builds project description context for a fresh replacement", () => {
		const prompt = buildProjectDescriptionPrompt({
			projectName: "Research activities",
			currentDescription: "Old description",
			notes: [
				{
					title: "Parallel YouTube",
					text: "Research for small teams and trading labs.",
				},
			],
		});

		expect(prompt).toContain("Project name: Research activities");
		expect(prompt).not.toContain("Current description to replace:");
		expect(prompt).not.toContain("Old description");
		expect(prompt).toContain("Parallel YouTube");
		expect(prompt).toContain("fresh replacement description");
	});

	it("uses the current project description only when notes are unavailable", () => {
		const prompt = buildProjectDescriptionPrompt({
			projectName: "Research activities",
			currentDescription: "Old description",
			notes: [],
		});

		expect(prompt).toContain("Current description to replace:");
		expect(prompt).toContain("Old description");
		expect(prompt).toContain("No project notes are available yet.");
	});

	it("preserves organization and people name casing in fallback chat titles", () => {
		expect(
			deriveFallbackChatTitle({
				userText: "why did OpenAI hire Sam Altman for GPT-5 work?",
			}),
		).toBe("OpenAI hire Sam Altman");
	});
});
