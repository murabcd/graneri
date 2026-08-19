import {
	type AppSourceProvider,
	getChatAppSourceLabel,
} from "@workspace/ai/capability-metadata";
import type { UIMessage } from "ai";
import {
	extractFileParts,
	extractGeneratedArtifacts,
} from "@/lib/chat-message";
import {
	collectMessageAppProviders,
	collectMessageSources,
} from "@/lib/chat-sources";

export type ChatSummaryArtifact = {
	filename?: string;
	mediaType: string;
	url: string;
};

export type ChatSummarySource =
	| ({ kind: "file" } & ChatSummaryArtifact)
	| {
			filename?: string;
			kind: "document";
			mediaType: string;
			sourceId: string;
			title: string;
	  }
	| {
			href: string;
			kind: "url";
			title: string;
	  };

export type ChatSummaryApp = {
	provider: AppSourceProvider;
	title: string;
};

export type ChatSummaryContent = {
	appsUsed: ChatSummaryApp[];
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
		case "file":
			return `file:${source.url}`;
		case "document":
			return `document:${source.sourceId}`;
		case "url":
			return `url:${source.href}`;
	}
};

const collectMessageSummarySources = (
	message: UIMessage,
): ChatSummarySource[] => {
	const files =
		message.role === "user"
			? extractFileParts(message).map(
					(file) =>
						({
							...toSummaryArtifact(file),
							kind: "file",
						}) satisfies ChatSummarySource,
				)
			: [];
	const referencedDocuments = message.parts.flatMap((part) =>
		part.type === "source-document"
			? [
					{
						...(part.filename && { filename: part.filename }),
						kind: "document",
						mediaType: part.mediaType,
						sourceId: part.sourceId,
						title: part.title,
					} satisfies ChatSummarySource,
				]
			: [],
	);
	const referencedUrls = collectMessageSources(message).map(
		(source) =>
			({
				href: source.href,
				kind: "url",
				title: source.title,
			}) satisfies ChatSummarySource,
	);

	return [...files, ...referencedDocuments, ...referencedUrls];
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
	const providers = [...new Set(messages.flatMap(collectMessageAppProviders))];

	return {
		appsUsed: providers.map((provider) => ({
			provider,
			title: getChatAppSourceLabel(provider),
		})),
		artifacts: collectArtifacts(messages),
		sources,
	};
};
