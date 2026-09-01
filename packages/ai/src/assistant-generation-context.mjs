const projectOpenAiProviderMetadata = (providerMetadata) => {
	const openai = providerMetadata?.openai;
	if (
		!openai ||
		typeof openai !== "object" ||
		Array.isArray(openai) ||
		!("itemId" in openai)
	) {
		return providerMetadata;
	}

	const { itemId: _generationBoundItemId, ...semanticOpenAiMetadata } = openai;
	return {
		...providerMetadata,
		openai: semanticOpenAiMetadata,
	};
};

const projectPartForAssistantGeneration = (part) => {
	const providerMetadata = projectOpenAiProviderMetadata(part.providerMetadata);
	const callProviderMetadata = projectOpenAiProviderMetadata(
		part.callProviderMetadata,
	);
	const resultProviderMetadata = projectOpenAiProviderMetadata(
		part.resultProviderMetadata,
	);
	if (
		providerMetadata === part.providerMetadata &&
		callProviderMetadata === part.callProviderMetadata &&
		resultProviderMetadata === part.resultProviderMetadata
	) {
		return part;
	}

	return {
		...part,
		...(providerMetadata !== part.providerMetadata && { providerMetadata }),
		...(callProviderMetadata !== part.callProviderMetadata && {
			callProviderMetadata,
		}),
		...(resultProviderMetadata !== part.resultProviderMetadata && {
			resultProviderMetadata,
		}),
	};
};

export const projectUiMessagesForAssistantGeneration = (messages) =>
	messages.map((message) => {
		const parts = message.parts.map(projectPartForAssistantGeneration);
		return parts.every((part, index) => part === message.parts[index])
			? message
			: { ...message, parts };
	});
