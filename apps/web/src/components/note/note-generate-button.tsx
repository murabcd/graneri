import { Button } from "@workspace/ui/components/button";
import { LoaderCircle, Zap } from "lucide-react";

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
			className="pointer-events-auto h-8 px-4"
			onClick={onClick}
			disabled={isGenerating}
		>
			{isGenerating ? (
				<LoaderCircle className="size-4 animate-spin" />
			) : (
				<Zap className="size-4" />
			)}
			{isGenerating ? "Generating…" : "Generate notes"}
		</Button>
	);
}
