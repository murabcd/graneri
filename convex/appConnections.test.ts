import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return { asOwner, t, workspaceId };
};

test("PostHog settings include endpoint metadata for token-backed connections", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const connectionId = await t.run((ctx) =>
		ctx.db.insert("appConnections", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			provider: "posthog",
			status: "connected",
			displayName: "PostHog Cloud",
			baseUrl: "https://us.posthog.com/mcp",
			token: "access-token",
			accountId: "client-id",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	const settings = await asOwner.query(api.appConnections.getPostHog, {
		workspaceId,
	});

	expect(settings).toEqual({
		sourceId: `app:${connectionId}`,
		provider: "posthog",
		status: "connected",
		displayName: "PostHog Cloud",
		endpoint: "https://us.posthog.com/mcp",
		oauthClientId: "client-id",
	});
});

test("PostHog settings are hidden until the connection has a token", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await t.run((ctx) =>
		ctx.db.insert("appConnections", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			provider: "posthog",
			status: "connected",
			displayName: "PostHog Cloud",
			baseUrl: "https://us.posthog.com/mcp",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	const settings = await asOwner.query(api.appConnections.getPostHog, {
		workspaceId,
	});

	expect(settings).toBeNull();
});

test("Notion settings support endpoint-only connections", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const connectionId = await t.run((ctx) =>
		ctx.db.insert("appConnections", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			provider: "notion",
			status: "connected",
			displayName: "Notion",
			baseUrl: "https://mcp.notion.com/mcp",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	const settings = await asOwner.query(api.appConnections.getNotion, {
		workspaceId,
	});

	expect(settings).toEqual({
		sourceId: `app:${connectionId}`,
		provider: "notion",
		status: "connected",
		displayName: "Notion",
		endpoint: "https://mcp.notion.com/mcp",
	});
});

test("selected chat sources include token-backed MCP OAuth connections", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const [posthogConnectionId, notionConnectionId, zoomConnectionId] =
		await t.run(async (ctx) => {
			const commonFields = {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId,
				status: "connected" as const,
				token: "access-token",
				accountId: "client-id",
				envJson: JSON.stringify({ "X-Team": "growth" }),
				createdAt: 1_000,
				updatedAt: 1_000,
			};

			return await Promise.all([
				ctx.db.insert("appConnections", {
					...commonFields,
					provider: "posthog",
					displayName: "PostHog Cloud",
					baseUrl: "https://us.posthog.com/mcp",
				}),
				ctx.db.insert("appConnections", {
					...commonFields,
					provider: "notion",
					displayName: "Notion",
					baseUrl: "https://mcp.notion.com/mcp",
				}),
				ctx.db.insert("appConnections", {
					...commonFields,
					provider: "zoom",
					displayName: "Zoom",
					baseUrl: "https://mcp.zoom.us/mcp/zoom/streamable",
				}),
			]);
		});

	const selected = await asOwner.query(api.appConnections.getSelectedForChat, {
		workspaceId,
		sourceIds: [
			`app:${posthogConnectionId}`,
			`app:${notionConnectionId}`,
			`app:${zoomConnectionId}`,
		],
	});

	expect(selected).toEqual([
		{
			sourceId: `app:${posthogConnectionId}`,
			provider: "posthog",
			displayName: "PostHog Cloud",
			baseUrl: "https://us.posthog.com/mcp",
			env: { "X-Team": "growth" },
			oauthClientId: "client-id",
			oauthAccessToken: "access-token",
		},
		{
			sourceId: `app:${notionConnectionId}`,
			provider: "notion",
			displayName: "Notion",
			baseUrl: "https://mcp.notion.com/mcp",
			env: { "X-Team": "growth" },
			oauthClientId: "client-id",
			oauthAccessToken: "access-token",
		},
		{
			sourceId: `app:${zoomConnectionId}`,
			provider: "zoom",
			displayName: "Zoom",
			baseUrl: "https://mcp.zoom.us/mcp/zoom/streamable",
			env: { "X-Team": "growth" },
			oauthClientId: "client-id",
			oauthAccessToken: "access-token",
		},
	]);
});
