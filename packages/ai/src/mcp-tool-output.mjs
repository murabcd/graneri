export const mcpToolOutputForModel = ({ output }) => {
	if (!Array.isArray(output?.content)) {
		return { type: "json", value: output };
	}

	const value = output.content.map((part) => {
		if (part?.type === "text" && typeof part.text === "string") {
			return { type: "text", text: part.text };
		}
		if (
			part?.type === "image" &&
			typeof part.data === "string" &&
			typeof part.mimeType === "string"
		) {
			return {
				type: "file",
				mediaType: part.mimeType,
				data: { type: "data", data: part.data },
			};
		}

		return { type: "text", text: JSON.stringify(part) };
	});
	if (output.structuredContent !== undefined || output.isError) {
		value.unshift({
			type: "text",
			text: JSON.stringify({
				structuredContent: output.structuredContent,
				isError: output.isError ?? false,
			}),
		});
	}
	return { type: "content", value };
};
