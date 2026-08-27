const GRANERI_TOOL_METADATA_KEY = "graneri";

const AI_TOOL_APPROVAL_REQUIREMENTS = new Set(["not_required", "required"]);
const AI_TOOL_ACCESS_LEVELS = new Set(["read", "write"]);
const AI_TOOL_CAPABILITIES = new Set([
	"create",
	"generate",
	"read",
	"search",
	"write",
]);

const requireValidAiToolPolicy = (policy) => {
	if (!AI_TOOL_ACCESS_LEVELS.has(policy.access)) {
		throw new Error(`Invalid AI tool access level: ${policy.access}.`);
	}
	if (!AI_TOOL_APPROVAL_REQUIREMENTS.has(policy.approval)) {
		throw new Error(
			`Invalid AI tool approval requirement: ${policy.approval}.`,
		);
	}
	if (!AI_TOOL_CAPABILITIES.has(policy.capability)) {
		throw new Error(`Invalid AI tool capability: ${policy.capability}.`);
	}
	if (typeof policy.provider !== "string" || !policy.provider.trim()) {
		throw new Error("AI tool policy requires a provider.");
	}
	if (
		policy.requiresConnection !== undefined &&
		typeof policy.requiresConnection !== "boolean"
	) {
		throw new Error("AI tool connection policy must be a boolean.");
	}

	return policy;
};

export const createAiToolMetadata = ({ policy, ui }) => ({
	[GRANERI_TOOL_METADATA_KEY]: {
		authority: { ...requireValidAiToolPolicy(policy) },
	},
	ui,
});

const getAiToolAuthority = (toolDefinition) => {
	const authority =
		toolDefinition.metadata?.[GRANERI_TOOL_METADATA_KEY]?.authority;
	return authority?.approval === "required" ? authority : null;
};

export const buildAiToolApprovalConfiguration = (tools) => {
	if (!tools) {
		return undefined;
	}

	const entries = Object.entries(tools).flatMap(([name, toolDefinition]) =>
		getAiToolAuthority(toolDefinition) ? [[name, "user-approval"]] : [],
	);

	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const classifyRemoteMcpToolPolicy = ({ annotations, provider }) => {
	const access = annotations?.readOnlyHint === true ? "read" : "write";

	return {
		access,
		approval: access === "read" ? "not_required" : "required",
		capability: access === "read" ? "read" : "write",
		provider,
	};
};
