import type { HostedUserQuestionOption } from "@workspace/ai/hosted-user-question";

const RECOMMENDED_SUFFIX = " (Recommended)";

export const getQuestionOptionPresentation = (
	option: HostedUserQuestionOption,
) => ({
	description: option.description,
	label: option.label.endsWith(RECOMMENDED_SUFFIX)
		? option.label.slice(0, -RECOMMENDED_SUFFIX.length)
		: option.label,
	recommended: option.label.endsWith(RECOMMENDED_SUFFIX),
});
