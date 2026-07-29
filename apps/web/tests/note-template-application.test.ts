import { describe, expect, it, vi } from "vitest";
import {
	requestEnhancedStructuredNote,
	requestTemplateStructuredNote,
} from "../src/lib/note-template-application";
import { loadRuntimeConfig } from "../src/lib/runtime-config";

const createNdjsonResponse = (lines: string[]) =>
	new Response(
		new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				for (const line of lines) {
					controller.enqueue(encoder.encode(`${line}\n`));
				}
				controller.close();
			},
		}),
		{ status: 200 },
	);

describe("note template application requests", () => {
	it("requests enhanced structured notes", async () => {
		const note = {
			title: "Weekly sync",
			overview: ["Reviewed progress"],
			sections: [],
		};
		const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json({
				note,
			}),
		);

		await expect(
			requestEnhancedStructuredNote(
				{
					title: "Weekly sync",
					noteText: "Reviewed progress",
					transcriptionLanguage: "en",
				},
				{
					fetcher,
					resolveConvexToken: async () => "convex-token",
				},
			),
		).resolves.toEqual(note);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/enhance-note",
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: "Bearer convex-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: "Weekly sync",
					noteText: "Reviewed progress",
					transcriptionLanguage: "en",
				}),
			}),
		);
	});

	it("parses streamed template rewrites and reports accumulated markdown", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
			createNdjsonResponse([
				JSON.stringify({ type: "text-delta", delta: "Intro" }),
				JSON.stringify({ type: "text-delta", delta: "\n- Item" }),
				JSON.stringify({
					type: "final-note",
					note: {
						overview: ["Intro"],
						sections: [{ title: "Next", items: ["Item"] }],
					},
				}),
			]),
		);
		const markdownUpdates: string[] = [];

		await expect(
			requestTemplateStructuredNote({
				title: "Weekly sync",
				noteText: "Intro",
				transcript: "Original English transcript",
				transcriptionLanguage: "en",
				template: {
					slug: "weekly-team-meeting",
					name: "Weekly",
					meetingContext: "Team sync",
					sections: [],
				},
				onMarkdown: (markdown) => {
					markdownUpdates.push(markdown);
				},
				fetcher,
				resolveConvexToken: async () => "convex-token",
			}),
		).resolves.toEqual({
			overview: ["Intro"],
			sections: [{ title: "Next", items: ["Item"] }],
		});
		expect(markdownUpdates).toEqual(["Intro", "Intro\n- Item"]);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/apply-template",
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: "Bearer convex-token",
					"Content-Type": "application/json",
					Accept: "application/x-ndjson",
				},
			}),
		);
		const requestBody = JSON.parse(
			String(fetcher.mock.calls[0]?.[1]?.body),
		) as unknown;
		expect(requestBody).toEqual({
			title: "Weekly sync",
			noteText: "Intro",
			transcript: "Original English transcript",
			transcriptionLanguage: "en",
			template: {
				slug: "weekly-team-meeting",
				name: "Weekly",
				meetingContext: "Team sync",
				sections: [],
			},
		});
	});

	it("fails closed before note generation when authentication is unavailable", async () => {
		const fetcher = vi.fn<typeof fetch>();

		await expect(
			requestEnhancedStructuredNote(
				{
					title: "Weekly sync",
					noteText: "Reviewed progress",
					transcriptionLanguage: null,
				},
				{
					fetcher,
					resolveConvexToken: async () => null,
				},
			),
		).rejects.toThrow("Authentication is required.");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("routes note generation through the desktop local API origin", async () => {
		const originalDesktopBridge = window.graneriDesktop;
		const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json({
				note: {
					title: "Weekly sync",
					overview: ["Reviewed progress"],
					sections: [],
				},
			}),
		);

		try {
			window.graneriDesktop = {
				getRuntimeConfig: async () => ({
					convexUrl: "https://convex.example",
					convexSiteUrl: "https://convex-site.example",
					localApiOrigin: "http://127.0.0.1:43210",
				}),
			} as Window["graneriDesktop"];
			await loadRuntimeConfig();
			await requestEnhancedStructuredNote(
				{
					title: "Weekly sync",
					transcript: "Reviewed progress",
					transcriptionLanguage: null,
				},
				{
					fetcher,
					resolveConvexToken: async () => "convex-token",
				},
			);
		} finally {
			window.graneriDesktop = originalDesktopBridge;
			await loadRuntimeConfig();
		}

		expect(fetcher).toHaveBeenCalledWith(
			"http://127.0.0.1:43210/api/enhance-note",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
