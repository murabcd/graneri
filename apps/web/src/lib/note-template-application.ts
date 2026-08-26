import { getCachedConvexToken } from "@/lib/convex-token";
import { logInfo } from "@/lib/logger";
import type { NoteTemplate } from "@/lib/note-templates";
import { getHostedApiUrl } from "@/lib/runtime-config";
import {
	isStructuredNote,
	type StructuredNote,
	type StructuredNoteBody,
} from "@/lib/structured-note";

type NoteTemplateFetch = typeof fetch;

const requireAuthorizationHeader = async (
	resolveConvexToken: typeof getCachedConvexToken,
) => {
	const convexToken = await resolveConvexToken();
	if (!convexToken) {
		throw new Error("Authentication is required.");
	}

	return `Bearer ${convexToken}`;
};

export type EnhancedStructuredNoteRequest = {
	title: string;
	rawNotes?: string;
	transcript?: string;
	noteText?: string;
	transcriptionLanguage: string | null;
};

export const requestEnhancedStructuredNote = async (
	body: EnhancedStructuredNoteRequest,
	{
		fetcher = fetch,
		resolveConvexToken = getCachedConvexToken,
	}: {
		fetcher?: NoteTemplateFetch;
		resolveConvexToken?: typeof getCachedConvexToken;
	} = {},
) => {
	const authorization = await requireAuthorizationHeader(resolveConvexToken);
	const response = await fetcher(getHostedApiUrl("enhanceNote"), {
		method: "POST",
		headers: {
			Authorization: authorization,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const payload = (await response.json().catch(() => ({}))) as {
		error?: string;
		note?: StructuredNote;
	};
	const payloadKeys = Object.keys(payload);

	logInfo({
		event: "enhance_note.renderer_response",
		ok: response.ok,
		payloadKeys,
		status: response.status,
	});

	if (!response.ok) {
		throw new Error(payload.error || "Failed to enhance note.");
	}

	if (!isStructuredNote(payload.note)) {
		throw new Error(
			`Failed to enhance note (${response.status}; payload keys: ${
				payloadKeys.length > 0 ? payloadKeys.join(", ") : "empty object"
			}).`,
		);
	}

	return payload.note;
};

type TemplateRewriteEvent =
	| {
			type: "text-delta";
			delta?: string;
	  }
	| {
			type: "final-note";
			note?: StructuredNoteBody;
	  }
	| {
			type: "error";
			error?: string;
	  };

export const requestTemplateStructuredNote = async ({
	title,
	noteText,
	transcriptionLanguage,
	transcript,
	template,
	onMarkdown,
	fetcher = fetch,
	resolveConvexToken = getCachedConvexToken,
}: {
	title: string;
	noteText: string;
	transcriptionLanguage: string | null;
	transcript?: string;
	template: NoteTemplate;
	onMarkdown: (markdown: string) => void;
	fetcher?: NoteTemplateFetch;
	resolveConvexToken?: typeof getCachedConvexToken;
}) => {
	const authorization = await requireAuthorizationHeader(resolveConvexToken);
	const response = await fetcher(getHostedApiUrl("applyTemplate"), {
		method: "POST",
		headers: {
			Authorization: authorization,
			"Content-Type": "application/json",
			Accept: "application/x-ndjson",
		},
		body: JSON.stringify({
			title,
			noteText,
			transcriptionLanguage,
			transcript,
			template,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(errorText || "Failed to apply template.");
	}

	const stream = response.body;
	if (!stream) {
		throw new Error("Template rewrite stream is not available.");
	}

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let finalNote: StructuredNoteBody | null = null;
	let responseError: string | null = null;
	let bufferedResponse = "";
	let streamedText = "";

	const handleEvent = (rawLine: string) => {
		const line = rawLine.trim();
		if (!line) {
			return;
		}

		const payload = JSON.parse(line) as TemplateRewriteEvent;

		if (payload.type === "text-delta") {
			streamedText += payload.delta ?? "";
			onMarkdown(streamedText);
			return;
		}

		if (payload.type === "final-note") {
			finalNote = payload.note ?? null;
			return;
		}

		responseError = payload.error ?? "Failed to apply template.";
	};

	let isDone = false;
	while (!isDone) {
		// ReadableStream chunks must be consumed sequentially; parallel reads would corrupt ordering.
		const { done, value } = await reader.read();
		isDone = done;
		bufferedResponse += decoder.decode(value ?? new Uint8Array(), {
			stream: !done,
		});

		const lines = bufferedResponse.split("\n");
		bufferedResponse = lines.pop() ?? "";
		for (const nextLine of lines) {
			handleEvent(nextLine);
		}
	}

	if (bufferedResponse.trim()) {
		handleEvent(bufferedResponse);
	}

	if (responseError) {
		throw new Error(responseError);
	}

	if (!finalNote) {
		throw new Error(
			"Template rewrite finished without a validated structured note.",
		);
	}

	return finalNote;
};
