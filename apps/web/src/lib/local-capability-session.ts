import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import { extractLocalPathReferences } from "@workspace/ai/local-path-references";
import {
	authorizeDesktopLocalCapabilitySession,
	getDesktopLocalCapabilitySession,
	pickDesktopLocalFolder,
	revokeDesktopLocalCapabilitySession,
} from "@workspace/platform/desktop";

const requireDesktopCapabilityResult = <Result>(
	result: Result | null,
): Result => {
	if (!result) {
		throw new Error("Local capabilities are unavailable in this runtime.");
	}

	return result;
};

export const getLocalCapabilitySession = async (scope: string) =>
	requireDesktopCapabilityResult(await getDesktopLocalCapabilitySession(scope))
		.session;

export const pickLocalCapabilityFolder = async (scope: string) =>
	requireDesktopCapabilityResult(await pickDesktopLocalFolder(scope));

export const revokeLocalCapabilitySession = async (scope: string) => {
	requireDesktopCapabilityResult(
		await revokeDesktopLocalCapabilitySession(scope),
	);
};

export const authorizeLocalCapabilityFromText = async ({
	currentSession,
	scope,
	text,
}: {
	currentSession: LocalCapabilitySession | null;
	scope: string;
	text: string;
}) => {
	const paths = [...new Set(extractLocalPathReferences(text))];

	if (paths.length === 0) {
		return currentSession;
	}
	if (paths.length > 1) {
		throw new Error("Ask AI can use one local folder per chat.");
	}

	const result = await authorizeDesktopLocalCapabilitySession(
		scope,
		paths[0],
	).catch((error: unknown) => {
		throw new Error(
			error instanceof Error
				? error.message
				: "Failed to authorize the local folder.",
		);
	});
	return requireDesktopCapabilityResult(result).session;
};
