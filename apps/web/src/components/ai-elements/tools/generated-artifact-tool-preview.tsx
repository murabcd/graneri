import type { FileUIPart, JSONValue } from "ai";
import { ChatMessageFileAttachments } from "@/components/chat/message-file-attachments";
import { parseGeneratedArtifacts } from "@/lib/chat-message";

export function GeneratedArtifactToolPreview({
	output,
}: {
	output?: JSONValue;
}) {
	const files: FileUIPart[] = parseGeneratedArtifacts(output).map(
		(artifact) => ({
			type: "file",
			filename: artifact.filename,
			mediaType: artifact.mediaType,
			providerMetadata: {
				graneri: {
					...artifact.providerMetadata.graneri,
					sizeBytes: artifact.sizeBytes,
				},
			},
			url: artifact.url,
		}),
	);

	return <ChatMessageFileAttachments files={files} />;
}
