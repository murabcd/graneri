import {
	buildSelectedAppSourceInstructions,
	getSelectedAppSourceIds,
} from "./capability-metadata.mjs";
import { buildCapabilityToolSet } from "./capability-registry.mjs";

export const getWorkspaceToolConnectionId = (connection) => {
	const id = connection.sourceId ?? connection.id;
	if (!id) {
		throw new Error(
			`Connected capability ${connection.provider} is missing its source identity.`,
		);
	}
	return id;
};

export const getWorkspaceToolConnectionDisplayName = (connection) =>
	connection.displayName ?? connection.title ?? connection.provider;

const deduplicateConnections = (connections) =>
	Array.from(
		new Map(
			connections.map((connection) => [
				getWorkspaceToolConnectionId(connection),
				connection,
			]),
		).values(),
	);

export const loadWorkspaceToolConnections = async (sources) => {
	const results = await Promise.allSettled(
		sources.map((source) => source.load()),
	);
	const connections = results.flatMap((result, index) => {
		if (result.status === "fulfilled") {
			return result.value;
		}

		console.error(
			`${sources[index].label} workspace tools could not be loaded.`,
			result.reason,
		);
		return [];
	});

	return deduplicateConnections(connections);
};

export const buildWorkspaceToolCatalog = async ({
	adapters,
	builtInTools = {},
	connections,
	scope,
	selectedSourceIds = [],
}) => {
	const availableConnections = deduplicateConnections(connections);
	const selectedIds = new Set(getSelectedAppSourceIds(selectedSourceIds));
	const selectedConnections = availableConnections.filter((connection) =>
		selectedIds.has(getWorkspaceToolConnectionId(connection)),
	);
	let toolConnections = [];
	if (scope === "available") {
		toolConnections = availableConnections;
	} else if (scope === "selected") {
		toolConnections = selectedConnections;
	}
	const capabilityTools =
		scope === "disabled"
			? {}
			: await buildCapabilityToolSet(toolConnections, adapters);

	return {
		availableConnections,
		selectedConnections,
		selectedSourceInstructions:
			buildSelectedAppSourceInstructions(selectedConnections),
		tools: { ...builtInTools, ...capabilityTools },
	};
};
