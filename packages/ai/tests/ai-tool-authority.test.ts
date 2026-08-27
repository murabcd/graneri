import { describe, expect, it } from "vitest";
import {
	type AiToolPolicy,
	createAiToolMetadata,
} from "../src/ai-tool-authority.mjs";

const readPolicy = {
	access: "read",
	approval: "not_required",
	capability: "read",
	provider: "graneri",
} satisfies AiToolPolicy;

const ui = {
	complete: "Read record",
	icon: "file-text",
	running: "Reading record",
};

describe("AI tool authority", () => {
	it("rejects an empty provider at the policy boundary", () => {
		expect(() =>
			createAiToolMetadata({
				policy: { ...readPolicy, provider: " " },
				ui,
			}),
		).toThrow("AI tool policy requires a provider");
	});

	it("snapshots authority metadata when a tool is defined", () => {
		const policy: AiToolPolicy = { ...readPolicy };
		const metadata = createAiToolMetadata({ policy, ui });

		policy.approval = "required";

		expect(metadata.graneri.authority.approval).toBe("not_required");
	});
});
