import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as desktopPlatform from "@workspace/platform/desktop";
import type { DesktopPermissionsStatus } from "@workspace/platform/desktop-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteTranscriptPanel } from "../src/components/note/note-transcript-panel";
import { createEmptyLiveTranscriptState } from "../src/lib/transcript";

const desktop = vi.hoisted(() => ({
	getPermissionsStatus: vi.fn(),
	isDesktopPlatform: vi.fn(),
}));

vi.mock("@workspace/platform/desktop", async (importOriginal) => ({
	...(await importOriginal<typeof desktopPlatform>()),
	getDesktopPermissionsStatus: desktop.getPermissionsStatus,
	isDesktopPlatform: desktop.isDesktopPlatform,
}));

const createPermissionStatus = (
	state: "granted" | "prompt",
): DesktopPermissionsStatus => ({
	isDesktop: true,
	platform: "darwin",
	permissions: [
		{
			id: "accessibility",
			description: "Named speaker access",
			required: false,
			state,
			canRequest: state === "prompt",
			canOpenSystemSettings: true,
		},
	],
});

beforeEach(() => {
	vi.clearAllMocks();
	desktop.isDesktopPlatform.mockReturnValue(true);
	desktop.getPermissionsStatus.mockResolvedValue(
		createPermissionStatus("prompt"),
	);
});

afterEach(cleanup);

describe("NoteTranscriptPanel", () => {
	const renderSpeakerTranscript = () =>
		render(
			<NoteTranscriptPanel
				liveTranscript={createEmptyLiveTranscriptState()}
				utterances={[
					{
						id: "utterance-0",
						speaker: "you",
						startedAt: 1_000,
						endedAt: 1_400,
						text: "My speech",
					},
					{
						id: "utterance-1",
						speaker: "them",
						speakerName: "Alex Morgan",
						startedAt: 1_500,
						endedAt: 1_900,
						text: "Named speech",
					},
					{
						id: "utterance-2",
						speaker: "them",
						startedAt: 2_000,
						endedAt: 2_500,
						text: "Uncertain speech",
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

	it("hides all speaker headings when Accessibility is off", async () => {
		renderSpeakerTranscript();
		await waitFor(() =>
			expect(desktop.getPermissionsStatus).toHaveBeenCalledOnce(),
		);

		expect(screen.getByText("My speech")).not.toBeNull();
		expect(screen.getByText("Named speech Uncertain speech")).not.toBeNull();
		expect(screen.queryByText("Named speech")).toBeNull();
		expect(screen.queryByText("You")).toBeNull();
		expect(screen.queryByText("Them")).toBeNull();
		expect(screen.queryByText("Alex Morgan")).toBeNull();
	});

	it("shows speaker headings while Accessibility is on and hides them after revocation", async () => {
		desktop.getPermissionsStatus.mockResolvedValue(
			createPermissionStatus("granted"),
		);
		renderSpeakerTranscript();

		await waitFor(() => expect(screen.getByText("Alex Morgan")).not.toBeNull());
		expect(screen.getByText("You")).not.toBeNull();
		expect(screen.getByText("Them")).not.toBeNull();
		expect(screen.getByText("Named speech")).not.toBeNull();
		expect(screen.getByText("Uncertain speech")).not.toBeNull();

		desktop.getPermissionsStatus.mockResolvedValue(
			createPermissionStatus("prompt"),
		);
		fireEvent.focus(window);

		await waitFor(() => expect(screen.queryByText("Alex Morgan")).toBeNull());
		expect(screen.queryByText("You")).toBeNull();
		expect(screen.queryByText("Them")).toBeNull();
		await waitFor(() =>
			expect(screen.getByText("Named speech Uncertain speech")).not.toBeNull(),
		);
	});

	it("hides speaker headings when a permission refresh fails", async () => {
		desktop.getPermissionsStatus.mockResolvedValue(
			createPermissionStatus("granted"),
		);
		renderSpeakerTranscript();
		await waitFor(() => expect(screen.getByText("Alex Morgan")).not.toBeNull());

		desktop.getPermissionsStatus.mockRejectedValue(
			new Error("Permission status unavailable"),
		);
		fireEvent.focus(window);

		await waitFor(() => expect(screen.queryByText("Alex Morgan")).toBeNull());
		expect(screen.queryByText("You")).toBeNull();
		expect(screen.queryByText("Them")).toBeNull();
		await waitFor(() =>
			expect(screen.getByText("Named speech Uncertain speech")).not.toBeNull(),
		);
	});

	it("loads the next completed-transcript page on demand", async () => {
		const loadMore = vi.fn();
		const user = userEvent.setup();
		render(
			<NoteTranscriptPanel
				liveTranscript={createEmptyLiveTranscriptState()}
				utterances={[
					{
						id: "utterance-1",
						speaker: "you",
						startedAt: 1_000,
						endedAt: 1_500,
						text: "First transcript page",
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
