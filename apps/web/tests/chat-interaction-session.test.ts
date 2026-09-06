import { expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { stopChatInteraction } from "../src/lib/chat-interaction-session";

const workspaceId = "workspace-1" as Id<"workspaces">;

const createStopArgs = () => ({
	chatId: "chat-1",
	contextLabel: "note chat",
	hasActiveRun: true,
	interruptActiveRun: false,
	stopActiveRun: vi.fn(async () => undefined),
	stopLocalStream: vi.fn(),
	workspaceId,
});

it("stops an external run without also stopping the persisted chat run", async () => {
	const args = createStopArgs();
	const stopExternalRun = vi.fn(async () => true);

	await stopChatInteraction({ ...args, stopExternalRun });

	expect(args.stopLocalStream).toHaveBeenCalledOnce();
	expect(stopExternalRun).toHaveBeenCalledOnce();
	expect(args.stopActiveRun).not.toHaveBeenCalled();
});

it("stops the persisted run with the requested interruption policy", async () => {
	const args = createStopArgs();

	await stopChatInteraction({ ...args, interruptActiveRun: true });

	expect(args.stopActiveRun).toHaveBeenCalledWith({
		chatId: "chat-1",
		interruptActiveRun: true,
		workspaceId,
	});
});

it("fails closed when a persisted run has no workspace", async () => {
	const args = createStopArgs();

	await expect(
		stopChatInteraction({ ...args, workspaceId: null }),
	).rejects.toThrow(
		"Cannot stop note chat stream without an active workspace.",
	);
	expect(args.stopLocalStream).toHaveBeenCalledOnce();
	expect(args.stopActiveRun).not.toHaveBeenCalled();
});
