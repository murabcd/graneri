import { cn } from "@workspace/ui/lib/utils";

export function ChatUnreadIndicator({ className }: { className?: string }) {
	return (
		<span
			role="img"
			aria-label="Unread AI response"
			className={cn("block size-2 rounded-full bg-chart-1", className)}
		/>
	);
}
