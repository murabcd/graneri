import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteTranscriptPanel } from "../src/components/note/note-transcript-panel";

afterEach(cleanup);

describe("NoteTranscriptPanel", () => {
	it("shows a verified remote name and leaves uncertain speech generic", () => {
		render(
			<NoteTranscriptPanel
				displayTranscriptEntries={[
					{
						id: "utterance-1",
						isLive: false,
						isProvisional: false,
						speaker: "them",
						speakerName: "Alex Morgan",
						startedAt: 1_000,
						endedAt: 1_500,
						text: "Named speech",
						utteranceIds: ["utterance-1"],
					},
					{
						id: "utterance-2",
						isLive: false,
						isProvisional: false,
						speaker: "them",
						startedAt: 2_000,
						endedAt: 2_500,
						text: "Uncertain speech",
						utteranceIds: ["utterance-2"],
					},
				]}
				state={{
					status: "ready",
					mode: "paused",
					pagination: { status: "complete" },
				}}
				transcriptStartedAt={1_000}
			/>,
		);

		expect(screen.getByText("Alex Morgan")).not.toBeNull();
		expect(screen.getByText("Them")).not.toBeNull();
	});

	it("loads the next completed-transcript page on demand", async () => {
		const loadMore = vi.fn();
		const user = userEvent.setup();
		render(
			<NoteTranscriptPanel
				displayTranscriptEntries={[
					{
						id: "utterance-1",
						isLive: false,
						isProvisional: false,
						speaker: "you",
						startedAt: 1_000,
						endedAt: 1_500,
						text: "First transcript page",
						utteranceIds: ["utterance-1"],
					},
				]}
				state={{
					status: "ready",
					mode: "paused",
					pagination: { status: "idle", loadMore },
				}}
				transcriptStartedAt={1_000}
			/>,
		);

		expect(screen.getByText("First transcript page")).not.toBeNull();
		await user.click(
			screen.getByRole("button", { name: "Load more transcript" }),
		);
		expect(loadMore).toHaveBeenCalledOnce();
	});
});
