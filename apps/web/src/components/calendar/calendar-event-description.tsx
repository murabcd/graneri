import {
	isDesktopRuntime,
	openDesktopExternalUrl,
} from "@workspace/platform/desktop";
import type * as React from "react";

const DESCRIPTION_URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":"]);
const CLOSING_DELIMITERS = {
	")": "(",
	"]": "[",
	"}": "{",
} as const;

const countCharacter = (value: string, character: string) =>
	Array.from(value).filter((candidate) => candidate === character).length;

const isClosingDelimiter = (
	character: string,
): character is keyof typeof CLOSING_DELIMITERS =>
	character === ")" || character === "]" || character === "}";

const trimUrlSuffix = (candidate: string) => {
	let url = candidate;
	let suffix = "";

	while (url.length > 0) {
		const lastCharacter = url.at(-1);
		if (!lastCharacter) {
			break;
		}

		if (TRAILING_PUNCTUATION.has(lastCharacter)) {
			url = url.slice(0, -1);
			suffix = `${lastCharacter}${suffix}`;
			continue;
		}

		const openingDelimiter = isClosingDelimiter(lastCharacter)
			? CLOSING_DELIMITERS[lastCharacter]
			: undefined;
		if (
			openingDelimiter &&
			countCharacter(url, lastCharacter) > countCharacter(url, openingDelimiter)
		) {
			url = url.slice(0, -1);
			suffix = `${lastCharacter}${suffix}`;
			continue;
		}

		break;
	}

	return { suffix, url };
};

const handleDescriptionLinkClick = (
	event: React.MouseEvent<HTMLAnchorElement>,
	url: string,
) => {
	if (!isDesktopRuntime()) {
		return;
	}

	event.preventDefault();
	void openDesktopExternalUrl(url);
};

export function CalendarEventDescription({
	description,
}: {
	description: string;
}) {
	const content: React.ReactNode[] = [];
	let cursor = 0;

	for (const match of description.matchAll(DESCRIPTION_URL_PATTERN)) {
		const candidate = match[0];
		const start = match.index;
		const { suffix, url } = trimUrlSuffix(candidate);

		if (start > cursor) {
			content.push(description.slice(cursor, start));
		}

		if (url) {
			content.push(
				<a
					className="break-all text-blue-500 underline underline-offset-2 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
					href={url}
					key={`description-link-${start}`}
					onClick={(event) => handleDescriptionLinkClick(event, url)}
					rel="noopener noreferrer"
					target="_blank"
				>
					{url}
				</a>,
			);
		}

		if (suffix) {
			content.push(suffix);
		}

		cursor = start + candidate.length;
	}

	if (cursor < description.length) {
		content.push(description.slice(cursor));
	}

	return (
		<p
			className="whitespace-pre-wrap break-words"
			data-calendar-event-description
		>
			{content}
		</p>
	);
}
