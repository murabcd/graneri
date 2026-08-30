import {
	type AppSourceProvider,
	getAppSourceProviderForToolName,
	getChatAppSourceLabel,
} from "@workspace/ai/capability-metadata";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
	extractFileParts,
	extractMessageFileParts,
	getChatMessageMetadata,
} from "@/lib/chat-message";

export type ChatSummaryArtifact = {
	filename?: string;
	mediaType: string;
	url: string;
};

export type ChatSummarySource =
	| {
			kind: "app";
			provider: AppSourceProvider;
			title: string;
	  }
	| ({ kind: "file" } & ChatSummaryArtifact)
	| {
			kind: "note";
			sourceId: string;
			title: string;
	  }
	| {
			kind: "web-search";
			title: "Web search";
	  };

export type ChatSummaryContent = {
	artifacts: ChatSummaryArtifact[];
	sources: ChatSummarySource[];
};

const WEB_SEARCH_SOURCE = {
	kind: "web-search",
	title: "Web search",
} satisfies ChatSummarySource;

const toSummaryArtifact = (artifact: ChatSummaryArtifact) => ({
	...(artifact.filename && { filename: artifact.filename }),
	mediaType: artifact.mediaType,
	url: artifact.url,
});

export const getChatSummarySourceKey = (source: ChatSummarySource) => {
	switch (source.kind) {
		case "app":
			return `app:${source.provider}`;
		case "file":
			return `file:${source.url}`;
		case "note":
			return `note:${source.sourceId}`;
		case "web-search":
			return "web-search";
	}
};

const collectMessageSummarySources = (
	message: UIMessage,
): ChatSummarySource[] => {
	const toolSources = message.parts.flatMap((part): ChatSummarySource[] => {
		if (
			!isToolUIPart(part) ||
			(part.state !== "output-available" && part.state !== "output-error")
		) {
			return [];
		}

		const toolName = getToolName(part);
		if (toolName === "web_search") {
			return [WEB_SEARCH_SOURCE];
		}

		const provider = getAppSourceProviderForToolName(toolName);
		return provider
			? [
					{
						kind: "app",
						provider,
						title: getChatAppSourceLabel(provider),
					} satisfies ChatSummarySource,
				]
			: [];
	});
	if (message.role !== "user") {
		return toolSources;
	}

	const files = extractFileParts(message).map(
		(file) =>
			({
				...toSummaryArtifact(file),
				kind: "file",
			}) satisfies ChatSummarySource,
	);
	const notes = (
		getChatMessageMetadata(message)?.mentionPositions ?? []
	).flatMap((mention) =>
		mention.type === "note"
			? [
					{
						kind: "note",
						sourceId: mention.id,
						title: mention.label,
					} satisfies ChatSummarySource,
				]
			: [],
	);

	return [...files, ...notes, ...toolSources];
};

const collectArtifacts = (messages: UIMessage[]): ChatSummaryArtifact[] => {
	const seen = new Set<string>();
	const artifacts: ChatSummaryArtifact[] = [];

	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}

		for (const value of extractMessageFileParts(message)) {
			const artifact = toSummaryArtifact(value);
			if (seen.has(artifact.url)) {
				continue;
			}

			seen.add(artifact.url);
			artifacts.push(artifact);
		}
	}

	return artifacts;
};

export const collectChatSummaryContent = (
	messages: UIMessage[],
): ChatSummaryContent => {
	const seenSources = new Set<string>();
	const sources: ChatSummarySource[] = [];

	for (const message of messages) {
		for (const source of collectMessageSummarySources(message)) {
			const key = getChatSummarySourceKey(source);
			if (seenSources.has(key)) {
				continue;
			}

			seenSources.add(key);
			sources.push(source);
		}
	}

	return {
		artifacts: collectArtifacts(messages),
		sources,
	};
};
