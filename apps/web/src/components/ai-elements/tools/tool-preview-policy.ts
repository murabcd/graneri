import type { ToolPartLike } from "@/components/ai-elements/tools/tool-registry";
import { parseGeneratedArtifacts } from "@/lib/chat-message";

export const hasCustomToolPreview = ({
	isError,
	toolPart,
}: {
	isError: boolean;
	toolPart: ToolPartLike;
}) =>
	!isError &&
	(toolPart.type === "tool-generate_image" ||
		toolPart.type === "tool-author_artifact") &&
	parseGeneratedArtifacts(toolPart.output).length > 0;
