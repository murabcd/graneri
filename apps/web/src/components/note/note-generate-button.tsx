import { Button } from "@workspace/ui/components/button";
import { Zap } from "lucide-react";
import { ShimmerText } from "@/components/ai-elements/shimmer";

export function NoteGenerateButton({
	isGenerating,
	onClick,
}: {
	isGenerating: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			variant="floating"
			size="sm"
			className="pointer-events-auto h-8 px-4 disabled:opacity-100"
			onClick={onClick}
			disabled={isGenerating}
		>
			{isGenerating ? null : <Zap className="size-4" />}
			{isGenerating ? (
				<ShimmerText as="span">Generating</ShimmerText>
			) : (
				"Generate notes"
			)}
		</Button>
	);
}
