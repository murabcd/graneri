import { afterEach, describe, expect, it, vi } from "vitest";
import {
	authorizeLocalCapabilityFromText,
	getLocalCapabilitySession,
	pickLocalCapabilityFolder,
	revokeLocalCapabilitySession,
} from "@/lib/local-capability-session";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
	vi.restoreAllMocks();
});

describe("local capability sessions", () => {
	it("has no current session outside desktop", async () => {
		window.graneriDesktop = undefined;

		await expect(getLocalCapabilitySession("chat:1")).resolves.toBeNull();
	});

	it("keeps the current session when text contains no local path", async () => {
		window.graneriDesktop = undefined;
		const session = { id: "capability-1", label: "graneri" };

		await expect(
			authorizeLocalCapabilityFromText({
				currentSession: session,
				scope: "chat:1",
				text: "summarize this note",
			}),
		).resolves.toEqual(session);
	});

	it("fails explicitly when a local path is used outside desktop", async () => {
		window.graneriDesktop = undefined;

		await expect(
			authorizeLocalCapabilityFromText({
				currentSession: null,
				scope: "chat:1",
				text: "read /Users/test/Documents/graneri",
			}),
		).rejects.toThrow("Local capabilities are unavailable in this runtime.");
	});

	it("authorizes one referenced path and exposes only the opaque descriptor", async () => {
		const authorizeLocalCapabilitySession = vi.fn().mockResolvedValue({
			session: { id: "capability-1", label: "graneri" },
		});
		window.graneriDesktop = {
			authorizeLocalCapabilitySession,
			platform: "darwin",
		} as Window["graneriDesktop"];

		await expect(
			authorizeLocalCapabilityFromText({
				currentSession: null,
				scope: "chat:1",
				text: "read /Users/test/Documents/graneri",
			}),
		).resolves.toEqual({ id: "capability-1", label: "graneri" });
		expect(authorizeLocalCapabilitySession).toHaveBeenCalledWith(
			"chat:1",
			"/Users/test/Documents/graneri",
		);
	});

	it("routes load, picker, and revocation through the scoped desktop owner", async () => {
		const getSession = vi.fn().mockResolvedValue({
			session: { id: "capability-1", label: "graneri" },
		});
		const pickLocalFolder = vi.fn().mockResolvedValue({
			canceled: false,
			session: { id: "capability-2", label: "fluently" },
		});
		const revokeSession = vi.fn().mockResolvedValue({ ok: true });
		window.graneriDesktop = {
			getLocalCapabilitySession: getSession,
			pickLocalFolder,
			platform: "darwin",
			revokeLocalCapabilitySession: revokeSession,
		} as Window["graneriDesktop"];

		await expect(getLocalCapabilitySession("chat:1")).resolves.toEqual({
			id: "capability-1",
			label: "graneri",
		});
		await expect(pickLocalCapabilityFolder("chat:1")).resolves.toEqual({
			canceled: false,
			session: { id: "capability-2", label: "fluently" },
		});
		await expect(
			revokeLocalCapabilitySession("chat:1"),
		).resolves.toBeUndefined();
		expect(getSession).toHaveBeenCalledWith("chat:1");
		expect(pickLocalFolder).toHaveBeenCalledWith("chat:1");
		expect(revokeSession).toHaveBeenCalledWith("chat:1");
	});
});
