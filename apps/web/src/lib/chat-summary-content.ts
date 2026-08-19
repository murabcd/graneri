import {
	type AppSourceProvider,
	getChatAppSourceLabel,
} from "@workspace/ai/capability-metadata";
import type { UIMessage } from "ai";
import {
	extractFileParts,
	extractGeneratedArtifacts,
	getChatMessageMetadata,
} from "@/lib/chat-message";
import { collectMessageAppProviders } from "@/lib/chat-sources";

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
	  };

export type ChatSummaryContent = {
	artifacts: ChatSummaryArtifact[];
	sources: ChatSummarySource[];
};

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
	}
};

const collectMessageSummarySources = (
	message: UIMessage,
): ChatSummarySource[] => {
	const apps = collectMessageAppProviders(message).map(
		(provider) =>
			({
				kind: "app",
				provider,
				title: getChatAppSourceLabel(provider),
			}) satisfies ChatSummarySource,
	);
	if (message.role !== "user") {
		return apps;
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

	return [...files, ...notes, ...apps];
};

const collectArtifacts = (messages: UIMessage[]): ChatSummaryArtifact[] => {
	const seen = new Set<string>();

	return messages
		.flatMap((message) =>
			message.role === "assistant"
				? [...extractFileParts(message), ...extractGeneratedArtifacts(message)]
				: [],
		)
		.map(toSummaryArtifact)
		.filter((artifact) => {
			if (seen.has(artifact.url)) {
				return false;
			}

			seen.add(artifact.url);
			return true;
		});
};

export const collectChatSummaryContent = (
	messages: UIMessage[],
): ChatSummaryContent => {
	const seenSources = new Set<string>();
	const sources = messages
		.flatMap(collectMessageSummarySources)
		.filter((source) => {
			const key = getChatSummarySourceKey(source);
			if (seenSources.has(key)) {
				return false;
			}

			seenSources.add(key);
			return true;
		});
	return {
		artifacts: collectArtifacts(messages),
		sources,
	};
};
