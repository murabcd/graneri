import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

export type ToolSource = {
	href: string;
	title: string;
};

const toolSourceOutputSchema = z.object({
	sources: z.array(
		z.object({
			title: z.string().nullish(),
			url: z.string().min(1),
		}),
	),
});

const toDisplayTitle = (url: string, title?: string | null) => {
	if (typeof title === "string" && title.trim()) {
		return title;
	}

	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

const parseToolSourceOutput = (value: unknown) => {
	let decoded: unknown = value;
	if (typeof value === "string") {
		try {
			decoded = JSON.parse(value);
		} catch {
			return null;
		}
	}

	const result = toolSourceOutputSchema.safeParse(decoded);
	return result.success ? result.data : null;
};

const collectToolSources = (message: UIMessage): ToolSource[] => {
	const sources: ToolSource[] = [];

	for (const part of message.parts) {
		if (
			!isToolUIPart(part) ||
			part.state !== "output-available" ||
			getToolName(part) !== "web_search"
		) {
			continue;
		}

		const result = parseToolSourceOutput(part.output);
		if (!result) {
			continue;
		}

		for (const source of result.sources) {
			sources.push({
				href: source.url,
				title: toDisplayTitle(source.url, source.title),
			});
		}
	}

	const seen = new Set<string>();

	return sources.filter((source) => {
		const key = `${source.href}::${source.title}`;

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
};

export const collectMessageSources = (message: UIMessage): ToolSource[] => {
	const sources: ToolSource[] = [];

	for (const part of message.parts) {
		if (part.type !== "source-url") {
			continue;
		}

		sources.push({
			href: part.url,
			title: toDisplayTitle(part.url, part.title),
		});
	}

	sources.push(...collectToolSources(message));

	const seen = new Set<string>();

	return sources.filter((source) => {
		const key = `${source.href}::${source.title}`;

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
};
