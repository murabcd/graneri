import { createOpenAI } from "@ai-sdk/openai";
import { validateTypes } from "@ai-sdk/provider-utils";
import { generateText } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { buildClientLocalFolderTools } from "../src/local-folder-tools.mjs";

const requestSchema = z.object({
	tools: z.array(
		z.object({
			name: z.string(),
			strict: z.boolean().optional(),
			parameters: z.object({
				type: z.literal("object"),
				properties: z.record(z.string(), z.json()),
				anyOf: z.never().optional(),
			}),
		}),
	),
});

it("sends object-shaped local tool schemas and keeps dynamic MCP arguments open", async () => {
	const requests: z.infer<typeof requestSchema>[] = [];
	const intercepted = new Error("Captured before networking");
	const provider = createOpenAI({
		apiKey: "test-no-network",
		fetch: async (_url, init) => {
			if (typeof init?.body !== "string")
				throw new Error("Expected JSON request body");
			requests.push(requestSchema.parse(JSON.parse(init.body)));
			throw intercepted;
		},
	});
	const tools = buildClientLocalFolderTools([{ id: "shared", name: "shared" }]);
	await expect(
		generateText({
			model: provider("gpt-5.6-luna"),
			tools,
			prompt: "Discover local tools.",
			maxRetries: 0,
		}),
	).rejects.toThrow(intercepted.message);
	expect(requests).toHaveLength(1);
	const call = requests[0]?.tools.find(
		(tool) => tool.name === "call_local_mcp_tool",
	);
	expect(call?.strict).toBe(false);
	expect(call?.parameters.properties.arguments).toMatchObject({
		type: "object",
		additionalProperties: expect.any(Object),
	});
	const process = requests[0]?.tools.find(
		(tool) => tool.name === "interact_local_process",
	);
	expect(process?.parameters.properties.action).toHaveProperty("anyOf");
	const input = {
		rootIndex: 0,
		serverName: "documents",
		configurationHash: "a".repeat(64),
		toolName: "summarize",
		arguments: { filters: { columns: ["amount", "date"] }, limit: 50 },
	};
	await expect(
		validateTypes({
			schema: tools.call_local_mcp_tool.inputSchema,
			value: input,
		}),
	).resolves.toEqual(input);
});
