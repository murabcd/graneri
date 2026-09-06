import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MessageScroller,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMessageListContent } from "@/components/chat/message-list";

const artifactUrl = "https://files.example.test/generated-report.docx";
const refreshedArtifactUrl = `${artifactUrl}?signature=refreshed`;

const generatedArtifactMessage: UIMessage = {
	id: "assistant-artifact",
	role: "assistant",
	parts: [
		{
			type: "file",
			filename: "generated-report.docx",
			mediaType:
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			providerMetadata: {
				graneri: {
					sizeBytes: 2_483_200,
					storageId: "storage-generated-report",
				},
			},
			url: artifactUrl,
		},
		{
			type: "tool-author_document",
			toolCallId: "author-artifact-1",
			state: "output-available",
			input: {
				kind: "document_create",
				filename: "generated-report.docx",
			},
			output: {
				artifacts: [
					{
						filename: "generated-report.docx",
						mediaType:
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						providerMetadata: {
							graneri: {
								generatedBy: "ai",
								storageId: "storage-generated-report",
							},
						},
						sizeBytes: 2_483_200,
						url: refreshedArtifactUrl,
					},
				],
			},
		},
		{
			type: "text",
			text: "Created the file.",
			state: "done",
		},
	],
};

const renderMessage = () =>
	render(
		<TooltipProvider>
			<MessageScrollerProvider autoScroll>
				<MessageScroller>
					<MessageScrollerViewport>
						<ChatMessageListContent messages={[generatedArtifactMessage]} />
					</MessageScrollerViewport>
				</MessageScroller>
			</MessageScrollerProvider>
		</TooltipProvider>,
	);

afterEach(cleanup);

describe("generated artifact cards", () => {
	it("shows one ordinary file card outside the collapsed tool disclosure", async () => {
		const user = userEvent.setup();
		renderMessage();

		const workDisclosure = screen.getByRole("button", {
			name: /^Worked/,
		});
		const responseText = screen.getByText("Created the file.");
		const filename = screen.getByText("generated-report.docx");
		expect(
			workDisclosure.compareDocumentPosition(responseText) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			responseText.compareDocumentPosition(filename) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.getByText("DOCX · 2.4 MB")).toBeTruthy();
		expect(
			screen.getAllByRole("button", {
				name: "Download generated-report.docx",
			}),
		).toHaveLength(1);
		expect(screen.queryByText("Authored file")).toBeNull();

		await user.click(workDisclosure);

		expect(screen.getByText("Authored file")).toBeTruthy();
		expect(
			screen.getAllByRole("button", {
				name: "Download generated-report.docx",
			}),
		).toHaveLength(1);
	});
});
