import { describe, expect, it, vi } from "vitest";
import { requestGeneratedProjectDescription } from "../src/lib/project-description-generation";

describe("project description generation", () => {
	it("requests an authenticated generated description", async () => {
		const body = {
			projectName: "Research activities",
			currentDescription: "Old description",
			notes: [
				{
					title: "Parallel YouTube",
					text: "Research for small teams.",
				},
			],
		};
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({ description: "Fresh AI description" }),
			);

		await expect(
			requestGeneratedProjectDescription(body, {
				fetcher,
				resolveConvexToken: async () => "convex-token",
			}),
		).resolves.toBe("Fresh AI description");
		expect(fetcher).toHaveBeenCalledWith(
			"/api/generate-project-description",
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: "Bearer convex-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			}),
		);
	});

	it("fails closed when authentication is unavailable", async () => {
		const fetcher = vi.fn<typeof fetch>();

		await expect(
			requestGeneratedProjectDescription(
				{
					projectName: "Research activities",
					currentDescription: "",
					notes: [],
				},
				{
					fetcher,
					resolveConvexToken: async () => null,
				},
			),
		).rejects.toThrow("Authentication is required.");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("rejects generated descriptions outside the shared length contract", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ description: "x".repeat(256) }));

		await expect(
			requestGeneratedProjectDescription(
				{
					projectName: "Research activities",
					currentDescription: "",
					notes: [],
				},
				{
					fetcher,
					resolveConvexToken: async () => "convex-token",
				},
			),
		).rejects.toThrow("Generated project description is invalid.");
	});
});
