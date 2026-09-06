import { createOpenAI } from "@ai-sdk/openai";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAiTool } from "../src/ai-tool-definition.mjs";
import { CHAT_MODE } from "../src/chat-mode.mjs";
import {
	buildHostedChatAgentToolSet,
	createHostedChatAgent,
	createHostedChatPrepareStep,
} from "../src/hosted-chat-agent.mjs";
import { buildHostedChatRunPlan } from "../src/hosted-chat-run-plan.mjs";

const deferredTool = {
	description: "Search a connected source.",
	inputSchema: {},
	providerOptions: {
		openai: {
			deferLoading: true,
		},
	},
};

describe("hosted document input", () => {
	it("sends inline DOCX through the installed Responses adapter", async () => {
		const captured = new Error("Request captured before networking");
		const requestSchema = z.object({
			input: z.array(
				z.object({
					role: z.string(),
					content: z.union([
						z.string(),
						z.array(
							z.object({
								type: z.string(),
								filename: z.string().optional(),
								file_data: z.string().optional(),
							}),
						),
					]),
				}),
			),
		});
		const requests: z.infer<typeof requestSchema>[] = [];
		const provider = createOpenAI({
			apiKey: "test-no-network",
			fetch: async (_url, init) => {
				if (typeof init?.body !== "string")
					throw new Error("Expected request JSON");
				requests.push(requestSchema.parse(JSON.parse(init.body)));
				throw captured;
			},
		});
		const { agent } = createHostedChatAgent({
			provider,
			enabledTools: {},
			model: "gpt-5.6-luna",
			instructions: "Summarize documents.",
		});
		await expect(
			agent.generate({
				messages: [
					{
						role: "user",
						content: [
							{
								type: "file",
								filename: "brief.docx",
								mediaType:
									"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
								data: new Uint8Array([80, 75, 3, 4]),
							},
						],
					},
				],
			}),
		).rejects.toThrow(captured.message);
		expect(
			requests[0]?.input.find((message) => message.role === "user")?.content,
		).toContainEqual({
			type: "input_file",
			filename: "brief.docx",
			file_data:
				"data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==",
		});
	});
});

const immediateTool = {
	description: "Run immediately.",
	inputSchema: {},
};

describe("hosted chat agent tool set", () => {
	it("returns no agent tools when no tools are enabled", () => {
		const assembled = buildHostedChatAgentToolSet({
			enabledTools: {},
		});

		expect(assembled.agentTools).toBeUndefined();
		expect(assembled.finalizedToolSet.hasTools).toBe(false);
		expect(assembled.finalizedToolSet.toolCount).toBe(0);
		expect(assembled.toolApproval).toBeUndefined();
	});

	it("finalizes enabled tools for validation and agent execution", () => {
		const assembled = buildHostedChatAgentToolSet({
			enabledTools: {
				search_source: deferredTool,
			},
		});

		expect(assembled.tools.search_source).toBe(deferredTool);
		expect(assembled.tools.toolSearch).toBeDefined();
		expect(assembled.agentTools).toBeDefined();
		expect(assembled.agentTools?.search_source).toBe(deferredTool);
		expect(assembled.agentTools?.toolSearch).toBeDefined();
		expect(assembled.finalizedToolSet.hasToolSearch).toBe(true);
		expect(assembled.finalizedToolSet.deferredToolCount).toBe(1);
	});

	it("adds runtime-only agent tools without changing validation tools", () => {
		const assembled = buildHostedChatAgentToolSet({
			enabledTools: {
				web_search: immediateTool,
			},
			additionalAgentTools: {
				read_local_file: immediateTool,
			},
		});

		expect(assembled.tools.web_search).toBe(immediateTool);
		expect(assembled.tools.read_local_file).toBeUndefined();
		expect(assembled.agentTools?.web_search).toBe(immediateTool);
		expect(assembled.agentTools?.read_local_file).toBe(immediateTool);
		expect(assembled.finalizedToolSet.toolCount).toBe(1);
	});

	it("supports runtime-only agent tools when no enabled tools exist", () => {
		const assembled = buildHostedChatAgentToolSet({
			enabledTools: {},
			additionalAgentTools: {
				read_local_file: immediateTool,
			},
		});

		expect(assembled.tools.read_local_file).toBeUndefined();
		expect(assembled.agentTools?.read_local_file).toBe(immediateTool);
		expect(assembled.finalizedToolSet.hasTools).toBe(false);
	});

	it("maps Graneri tool policy into the AI SDK v7 approval configuration", () => {
		const deleteTool = defineAiTool({
			deferLoading: false,
			description: "Delete a record.",
			execute: async () => ({ deleted: true }),
			inputSchema: z.object({ id: z.string() }),
			name: "delete_record",
			policy: {
				access: "write",
				approval: "required",
				capability: "write",
				provider: "graneri",
			},
			ui: {
				complete: "Deleted record",
				icon: "trash",
				running: "Deleting record",
			},
		}).toAITool();
		const assembled = buildHostedChatAgentToolSet({
			enabledTools: {
				delete_record: deleteTool,
				read_record: immediateTool,
			},
		});

		expect(deleteTool.needsApproval).toBeUndefined();
		expect(deleteTool.metadata).toMatchObject({
			graneri: {
				authority: {
					access: "write",
					approval: "required",
				},
			},
		});
		expect(assembled.toolApproval).toEqual({
			delete_record: "user-approval",
		});
	});

	it("does not request approval for explicitly classified read tools", () => {
		const readTool = defineAiTool({
			description: "Read a record.",
			execute: async () => ({ found: true }),
			inputSchema: z.object({ id: z.string() }),
			name: "read_record",
			policy: {
				access: "read",
				approval: "not_required",
				capability: "read",
				provider: "graneri",
			},
			ui: {
				complete: "Read record",
				icon: "file-text",
				running: "Reading record",
			},
		}).toAITool();
		const assembled = buildHostedChatAgentToolSet({
			enabledTools: { read_record: readTool },
		});

		expect(assembled.toolApproval).toBeUndefined();
	});
});

describe("hosted chat prepare-step continuation", () => {
	it("preserves same-generation provider references while appending accepted steer input", async () => {
		const sameGenerationContext = [
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						text: "Current generation reasoning",
						providerOptions: {
							openai: { itemId: "rs_same_generation" },
						},
					},
				],
			},
		] satisfies ModelMessage[];
		const prepareStep = vi.fn(async () => ({
			messages: sameGenerationContext,
		}));
		const takePendingSteeredUserMessages = vi.fn(() => [
			{
				id: "queued-1",
				role: "user" as const,
				parts: [{ type: "text" as const, text: "Use this correction" }],
			},
		]);
		const prepareInTurnSteerInput = createHostedChatPrepareStep({
			getActiveStreamSession: () => ({
				takePendingSteeredUserMessages,
			}),
			prepareStep,
			tools: {},
		});

		const result = await prepareInTurnSteerInput({
			messages: [],
			stepNumber: 2,
		} as Parameters<typeof prepareInTurnSteerInput>[0]);

		expect(result?.messages).toEqual([
			...sameGenerationContext,
			{
				role: "user",
				content: [{ type: "text", text: "Use this correction" }],
			},
		]);
		expect(result?.messages?.[0]).toBe(sameGenerationContext[0]);
		expect(takePendingSteeredUserMessages).toHaveBeenCalledWith(2);
	});

	it("returns uninterrupted continuation settings unchanged when no steer input is pending", async () => {
		const sameGenerationContext = [
			{ role: "user", content: "Continue normally" },
		] satisfies ModelMessage[];
		const prepared = { messages: sameGenerationContext };
		const prepareStep = vi.fn(async () => prepared);
		const prepareUninterruptedStep = createHostedChatPrepareStep({
			getActiveStreamSession: () => ({
				takePendingSteeredUserMessages: () => [],
			}),
			prepareStep,
			tools: {},
		});

		const result = await prepareUninterruptedStep({
			messages: sameGenerationContext,
			stepNumber: 1,
		} as Parameters<typeof prepareUninterruptedStep>[0]);

		expect(result).toBe(prepared);
		expect(result?.messages).toBe(sameGenerationContext);
	});
});

describe("hosted chat run plan", () => {
	it("builds the shared prompt and separates validation tools from runtime-only tools", () => {
		const runPlan = buildHostedChatRunPlan({
			additionalAgentTools: {
				read_local_file: immediateTool,
			},
			appTools: {
				search_linear: immediateTool,
			},
			automationContext: {
				tools: {
					create_automation: immediateTool,
				},
			},
			chatMode: CHAT_MODE.PLAN,
			context: {
				notesContext: "Attached notes.",
				attachedNoteContext: "Current note.",
				compactionSummary: "Earlier history.",
				recipeContext: "Selected recipe.",
				userProfileContext: { name: "Ada" },
			},
			coreTools: {
				web_search: immediateTool,
			},
			localFolderContext: "Local folder context.",
			model: "gpt-5",
			selectedAppSourceInstructions: "Selected app source instruction.",
			webSearchEnabled: true,
		});

		expect(runPlan.instructions).toContain("Attached notes.");
		expect(runPlan.instructions).toContain("Current note.");
		expect(runPlan.instructions).toContain("Earlier history.");
		expect(runPlan.instructions).toContain("Selected recipe.");
		expect(runPlan.instructions).toContain("Local folder context.");
		expect(runPlan.instructions).toContain("Selected app source instruction.");
		expect(runPlan.instructions).toContain("Plan mode is active.");
		expect(runPlan.enabledTools.web_search).toBe(immediateTool);
		expect(runPlan.enabledTools.create_automation).toBe(immediateTool);
		expect(runPlan.enabledTools.search_linear).toBe(immediateTool);
		expect(runPlan.tools.read_local_file).toBeUndefined();
		expect(runPlan.agentTools?.read_local_file).toBe(immediateTool);
	});
});
