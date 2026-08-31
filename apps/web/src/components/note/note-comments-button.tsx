"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "convex/react";
import { MessageSquareText } from "lucide-react";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { OPEN_NOTE_COMMENTS_EVENT } from "./note-page-events";

export function NoteCommentsButton({
	noteId,
	isDesktopMac,
	onOpen,
}: {
	noteId: Id<"notes">;
	isDesktopMac: boolean;
	onOpen: (() => void) | null;
}) {
	const workspaceId = useActiveWorkspaceId();
	const hasComments =
		useQuery(
			api.noteComments.hasThreads,
			workspaceId
				? {
						workspaceId,
						noteId,
					}
				: "skip",
		) === true;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className={cn(
						"text-muted-foreground hover:text-foreground focus-visible:text-foreground",
						hasComments && "text-foreground",
					)}
					data-app-region={isDesktopMac ? "no-drag" : undefined}
					aria-label="Open comments"
					onClick={() => {
						if (onOpen) {
							onOpen();
							return;
						}

						window.dispatchEvent(new Event(OPEN_NOTE_COMMENTS_EVENT));
					}}
				>
					<MessageSquareText className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Open comments</TooltipContent>
		</Tooltip>
	);
}
