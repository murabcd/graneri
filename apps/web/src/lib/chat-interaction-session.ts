import type { Id } from "../../../../convex/_generated/dataModel";

export const stopChatInteraction = async ({
	chatId,
	contextLabel,
	hasDisplayActiveRun,
	interruptActiveRun,
	stopActiveRun,
	stopExternalRun,
	stopLocalStream,
	workspaceId,
}: {
	chatId: string;
	contextLabel: string;
	hasDisplayActiveRun: boolean;
	interruptActiveRun: boolean;
	stopActiveRun: (args: {
		chatId: string;
		interruptActiveRun: boolean;
		workspaceId: Id<"workspaces">;
	}) => Promise<void>;
	stopExternalRun?: () => Promise<boolean>;
	stopLocalStream: () => void;
	workspaceId: Id<"workspaces"> | null;
}) => {
	stopLocalStream();

	if (await stopExternalRun?.()) {
		return;
	}

	if (!hasDisplayActiveRun) {
		return;
	}

	if (!workspaceId) {
		throw new Error(
			`Cannot stop ${contextLabel} stream without an active workspace.`,
		);
	}

	await stopActiveRun({
		chatId,
		interruptActiveRun,
		workspaceId,
	});
};
