import { z } from "zod";
import { localToolDurationFields } from "./local-folder-file-contract.mjs";

export const localMcpServerNameSchema = z
	.string()
	.regex(/^[a-zA-Z0-9_-]{1,64}$/u);
const localMcpServerSchema = z.strictObject({
	command: z
		.enum(["node", "python3"])
		.describe("Graneri's managed runtime. Other executables are unsupported."),
	args: z.array(z.string().max(4096)).min(1).max(65),
});
export const localMcpConfigurationSchema = z.strictObject({
	mcpServers: z
		.record(localMcpServerNameSchema, localMcpServerSchema)
		.refine(
			(servers) => Object.keys(servers).length <= 20,
			"At most twenty local MCP servers may be configured.",
		),
});
const configurationHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const localMcpCallInputFields = {
	serverName: localMcpServerNameSchema,
	configurationHash: configurationHashSchema.describe(
		"Configuration hash from list_local_mcp_tools for this server. Changed configuration requires rediscovery.",
	),
	toolName: z.string().min(1).max(256),
	arguments: z.record(z.string(), z.json()),
};
export const localMcpDiscoverySchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("servers"),
		servers: z.array(localMcpServerNameSchema).max(20),
		...localToolDurationFields,
	}),
	z.object({
		kind: z.literal("tools"),
		serverName: localMcpServerNameSchema,
		configurationHash: configurationHashSchema,
		tools: z.array(
			z.object({
				name: z.string(),
				description: z.string(),
				inputSchema: z.record(z.string(), z.json()),
			}),
		),
		nextCursor: z.string().nullable(),
		...localToolDurationFields,
	}),
]);
export const localMcpCallOutputSchema = z.object({
	serverName: localMcpServerNameSchema,
	toolName: z.string(),
	result: z.record(z.string(), z.json()),
	...localToolDurationFields,
});
