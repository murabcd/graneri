import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import * as React from "react";
import { toast } from "sonner";
import {
	getLocalCapabilitySession,
	pickLocalCapabilityFolder,
	revokeLocalCapabilitySession,
} from "@/lib/local-capability-session";
import { logError } from "@/lib/logger";

type LocalCapabilityState = {
	scope: string;
	session: LocalCapabilitySession | null;
};

const reportLocalFolderActionError = ({
	error,
	fallbackMessage,
}: {
	error: unknown;
	fallbackMessage: string;
}) => {
	logError({
		event: "client.error",
		error,
		message: fallbackMessage,
	});
	toast.error(error instanceof Error ? error.message : fallbackMessage);
};

export const useLocalCapabilitySession = (scope: string) => {
	const revisionRef = React.useRef(0);
	const [state, setState] = React.useState<LocalCapabilityState>(() => ({
		scope,
		session: null,
	}));

	React.useEffect(() => {
		let isCurrent = true;
		const revision = revisionRef.current + 1;
		revisionRef.current = revision;

		void getLocalCapabilitySession(scope)
			.then((session) => {
				if (isCurrent && revisionRef.current === revision) {
					setState({ scope, session });
				}
			})
			.catch((error: unknown) => {
				if (isCurrent && revisionRef.current === revision) {
					setState({ scope, session: null });
					logError({
						event: "client.error",
						error,
						message: "Failed to load the local capability session.",
					});
				}
			});

		return () => {
			isCurrent = false;
		};
	}, [scope]);

	const commitSession = React.useCallback(
		(session: LocalCapabilitySession | null) => {
			revisionRef.current += 1;
			setState({ scope, session });
		},
		[scope],
	);
	const visibleSession = state.scope === scope ? state.session : null;
	const chooseLocalCapabilityFolder = React.useCallback(async () => {
		try {
			const revision = revisionRef.current + 1;
			revisionRef.current = revision;
			const result = await pickLocalCapabilityFolder(scope);

			if (result.canceled || revisionRef.current !== revision) {
				return;
			}

			commitSession(result.session);
		} catch (error) {
			reportLocalFolderActionError({
				error,
				fallbackMessage: "Failed to choose local folder.",
			});
		}
	}, [commitSession, scope]);
	const revokeLocalCapability = React.useCallback(async () => {
		try {
			const revision = revisionRef.current + 1;
			revisionRef.current = revision;
			await revokeLocalCapabilitySession(scope);

			if (revisionRef.current !== revision) {
				return;
			}

			commitSession(null);
		} catch (error) {
			reportLocalFolderActionError({
				error,
				fallbackMessage: "Failed to remove local folder.",
			});
		}
	}, [commitSession, scope]);

	return {
		chooseLocalCapabilityFolder,
		localCapabilitySession: visibleSession,
		reconcileLocalCapabilitySession: commitSession,
		revokeLocalCapability,
	};
};
