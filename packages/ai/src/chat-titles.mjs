const clampWhitespace = (value) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const truncate = (value, maxLength) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const uppercaseFirstCharacter = (value) => {
	if (!value) {
		return value;
	}

	return value.charAt(0).toUpperCase() + value.slice(1);
};

const normalizeComparisonText = (value) =>
	clampWhitespace(value)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "");

const GREETING_WORDS = new Set([
	"afternoon",
	"are",
	"buddy",
	"evening",
	"go",
	"going",
	"good",
	"hello",
	"hey",
	"hi",
	"how",
	"hows",
	"it",
	"man",
	"morning",
	"sup",
	"there",
	"up",
	"whats",
	"yo",
	"you",
]);

const LEADING_FILLER_PATTERNS = [
	/^(please\s+)?(can|could|would|will)\s+you\s+/i,
	/^(please\s+)?help\s+me\s+/i,
	/^i\s+need\s+(help\s+(with\s+)?)?/i,
	/^i\s+want\s+to\s+/i,
	/^how\s+do\s+i\s+/i,
	/^why\s+(did|does|do|is|are|was|were|has|have|had|can|could|would|will)\s+/i,
	/^what('?s| is)\s+/i,
	/^tell\s+me\s+about\s+/i,
	/^explain\s+/i,
	/^write\s+(me\s+)?/i,
];

const PLACEHOLDER_TITLES = new Set([
	"new chat",
	"new conversation",
	"untitled",
]);

const isGreetingOnly = (value) => {
	const normalized = normalizeComparisonText(value);

	if (!normalized) {
		return false;
	}

	const words = normalized.split(/\s+/).filter(Boolean);

	return words.length > 0 && words.length <= 8
		? words.every((word) => GREETING_WORDS.has(word))
		: false;
};

export const buildChatTitlePrompt = ({
	userText = "",
	assistantText = "",
} = {}) =>
	[
		"Conversation context:",
		userText ? `User: ${clampWhitespace(userText)}` : "",
		assistantText ? `Assistant: ${clampWhitespace(assistantText)}` : "",
		assistantText
			? "Base the title on the topic of the exchange, not the literal wording of the first message."
			: "Base the title on the user's topic, not the literal wording of the message.",
	]
		.filter(Boolean)
		.join("\n");

export const deriveFallbackChatTitle = ({
	userText = "",
	maxLength = 80,
} = {}) => {
	const normalizedUserText = clampWhitespace(userText);

	if (!normalizedUserText) {
		return "Quick chat";
	}

	if (isGreetingOnly(normalizedUserText)) {
		return "Quick check-in";
	}

	let candidate = normalizedUserText.replace(/[!?.,:;]+$/g, "");

	for (const pattern of LEADING_FILLER_PATTERNS) {
		candidate = candidate.replace(pattern, "");
	}

	candidate = clampWhitespace(candidate);

	if (!candidate) {
		return "Quick chat";
	}

	return uppercaseFirstCharacter(
		truncate(candidate.split(/\s+/).slice(0, 4).join(" "), maxLength),
	);
};

export const finalizeGeneratedChatTitle = ({
	generatedTitle = "",
	userText = "",
	maxLength = 80,
} = {}) => {
	const firstLine = String(generatedTitle).split("\n")[0] ?? "";
	const sanitizedTitle = clampWhitespace(
		firstLine
			.replace(/^[#*`"'\s]+/, "")
			.replace(/^(title|chat title)\s*:\s*/i, "")
			.replace(/["'`]+$/g, ""),
	);

	if (!sanitizedTitle) {
		return deriveFallbackChatTitle({ userText, maxLength });
	}

	const truncatedTitle = truncate(sanitizedTitle, maxLength);
	const normalizedTitle = normalizeComparisonText(truncatedTitle);
	const normalizedUserText = normalizeComparisonText(userText);
	const userWordCount = clampWhitespace(userText)
		.split(/\s+/)
		.filter(Boolean).length;

	if (PLACEHOLDER_TITLES.has(normalizedTitle)) {
		return deriveFallbackChatTitle({ userText, maxLength });
	}

	if (
		normalizedUserText &&
		normalizedTitle === normalizedUserText &&
		userWordCount > 4
	) {
		return deriveFallbackChatTitle({ userText, maxLength });
	}

	return truncatedTitle;
};
