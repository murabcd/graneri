import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeActiveChatRun } from "@/hooks/use-resume-active-chat-run";
import type { Id } from "../../../convex/_generated/dataModel";

type ActiveRun = Parameters<typeof useResumeActiveChatRun>[0]["activeRun"];

const createActiveRun = (status: "running" | "waiting_for_user") =>
	({
		_id: "run_1",
		status,
	}) as unknown as ActiveRun;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useResumeActiveChatRun", () => {
	it("does not reconnect while a run is waiting for user input", async () => {
		const resumeStream = vi.fn().mockResolvedValue(undefined);
		const { rerender } = renderHook(
			({ activeRun }: { activeRun: ActiveRun }) =>
				useResumeActiveChatRun({
					activeRun,
					chatId: "chat_1",
					resumeStream,
					workspaceId: "workspace_1" as Id<"workspaces">,
				}),
			{ initialProps: { activeRun: createActiveRun("waiting_for_user") } },
		);

		expect(resumeStream).not.toHaveBeenCalled();

		rerender({ activeRun: createActiveRun("running") });
		await waitFor(() => expect(resumeStream).toHaveBeenCalledOnce());
	});

	it("allows the same run to reconnect again after waiting for user input", async () => {
		const resumeStream = vi.fn().mockResolvedValue(undefined);
		const { rerender } = renderHook(
			({ activeRun }: { activeRun: ActiveRun }) =>
				useResumeActiveChatRun({
					activeRun,
					chatId: "chat_1",
					resumeStream,
					workspaceId: "workspace_1" as Id<"workspaces">,
				}),
			{ initialProps: { activeRun: createActiveRun("running") } },
		);

		await waitFor(() => expect(resumeStream).toHaveBeenCalledOnce());
		rerender({ activeRun: createActiveRun("waiting_for_user") });
		rerender({ activeRun: createActiveRun("running") });

		await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(2));
	});
});
