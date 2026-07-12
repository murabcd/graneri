import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteMcpConnectionSession } from "@/components/settings/use-remote-mcp-connection-session";
import type { Id } from "../../../convex/_generated/dataModel";

const { openDesktopExternalUrlMock, successToastMock } = vi.hoisted(() => ({
	openDesktopExternalUrlMock: vi.fn(),
	successToastMock: vi.fn(),
}));

vi.mock("@workspace/platform/desktop", () => ({
	isDesktopRuntime: () => true,
	openDesktopExternalUrl: openDesktopExternalUrlMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: successToastMock,
	},
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const defaultFormState = {
	name: "Figma",
	baseUrl: "https://mcp.figma.com/mcp",
	envVars: [],
	oauthClientId: "",
	oauthClientSecret: "",
};

describe("remote MCP connection session", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		openDesktopExternalUrlMock.mockResolvedValue(true);
	});

	it("hydrates an existing connection and resets secrets when the dialog closes", () => {
		const { result } = renderHook(() =>
			useRemoteMcpConnectionSession({
				workspaceId,
				connection: {
					sourceId: "figma-source",
					displayName: "Design",
					endpoint: "https://example.com/mcp",
					oauthClientId: "client-id",
				},
				defaultFormState,
				defaultDisplayName: "Figma",
				requireEnvValue: false,
				connect: vi.fn(),
				connectionLabel: "Figma",
				connectedMessage: "Continue in Figma",
				requiresOAuth: true,
			}),
		);

		act(() => result.current.handleOpenChange(true));
		expect(result.current.formState).toMatchObject({
			name: "Design",
			baseUrl: "https://example.com/mcp",
			oauthClientId: "client-id",
			oauthClientSecret: "",
		});

		act(() => result.current.setOAuthClientSecret("secret"));
		act(() => result.current.handleOpenChange(false));
		expect(result.current.formState).toEqual(defaultFormState);
	});

	it("owns OAuth navigation and closes after a successful connection", async () => {
		const connect = vi.fn().mockResolvedValue({
			authorizationUrl: "https://example.com/oauth",
		});
		const { result } = renderHook(() =>
			useRemoteMcpConnectionSession({
				workspaceId,
				connection: null,
				defaultFormState,
				defaultDisplayName: "Figma",
				requireEnvValue: false,
				connect,
				connectionLabel: "Figma",
				connectedMessage: "Continue in Figma",
				requiresOAuth: true,
			}),
		);

		act(() => result.current.handleOpenChange(true));
		await act(() => result.current.handleConnect());

		expect(connect).toHaveBeenCalledWith({
			workspaceId,
			displayName: "Figma",
			baseUrl: "https://mcp.figma.com/mcp",
			env: {},
		});
		expect(openDesktopExternalUrlMock).toHaveBeenCalledWith(
			"https://example.com/oauth",
		);
		expect(successToastMock).toHaveBeenCalledWith("Continue in Figma");
		await waitFor(() => expect(result.current.isOpen).toBe(false));
	});

	it("connects a header-based provider without entering OAuth navigation", async () => {
		const connect = vi.fn().mockResolvedValue({ sourceId: "context7-source" });
		const { result } = renderHook(() =>
			useRemoteMcpConnectionSession({
				workspaceId,
				connection: null,
				defaultFormState: {
					name: "Context7",
					baseUrl: "https://mcp.context7.com/mcp",
					envVars: [{ id: "key", key: "CONTEXT7_API_KEY", value: "secret" }],
				},
				defaultDisplayName: "Context7",
				requireEnvValue: true,
				connect,
				connectionLabel: "Context7",
				connectedMessage: "Context7 connected",
				requiresOAuth: false,
			}),
		);

		await act(() => result.current.handleConnect());

		expect(connect).toHaveBeenCalledWith({
			workspaceId,
			displayName: "Context7",
			baseUrl: "https://mcp.context7.com/mcp",
			env: { CONTEXT7_API_KEY: "secret" },
		});
		expect(openDesktopExternalUrlMock).not.toHaveBeenCalled();
		expect(successToastMock).toHaveBeenCalledWith("Context7 connected");
	});
});
