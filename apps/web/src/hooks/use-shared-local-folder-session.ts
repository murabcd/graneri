import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import * as React from "react";
import { toast } from "sonner";
import {
	clearSharedLocalFolder,
	pickSharedLocalFolder,
	requireRehydratedSharedLocalFolders,
	storeSharedLocalFolders,
} from "@/lib/local-folder-sharing";
import { logError } from "@/lib/logger";

const EMPTY_SHARED_LOCAL_FOLDERS: DesktopLocalFolder[] = [];

type SharedLocalFolderState = {
	folders: DesktopLocalFolder[];
	storageScope: string;
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

export const useSharedLocalFolderSession = (storageScope: string) => {
	const revisionRef = React.useRef(0);
	const [state, setState] = React.useState<SharedLocalFolderState>(() => ({
		folders: EMPTY_SHARED_LOCAL_FOLDERS,
		storageScope,
	}));

	React.useEffect(() => {
		let isCurrent = true;
		const revision = revisionRef.current + 1;
		revisionRef.current = revision;

		void requireRehydratedSharedLocalFolders(storageScope)
			.then((folders) => {
				if (isCurrent && revisionRef.current === revision) {
					setState({ folders, storageScope });
				}
			})
			.catch((error: unknown) => {
				if (isCurrent && revisionRef.current === revision) {
					setState({
						folders: EMPTY_SHARED_LOCAL_FOLDERS,
						storageScope,
					});
					logError({
						event: "client.error",
						error,
						message: "Failed to re-register shared local folders.",
					});
				}
			});

		return () => {
			isCurrent = false;
		};
	}, [storageScope]);

	const commitSharedLocalFolders = React.useCallback(
		(folders: DesktopLocalFolder[]) => {
			revisionRef.current += 1;
			storeSharedLocalFolders(storageScope, folders);
			setState({ folders, storageScope });
		},
		[storageScope],
	);
	const visibleFolders =
		state.storageScope === storageScope
			? state.folders
			: EMPTY_SHARED_LOCAL_FOLDERS;
	const chooseSharedLocalFolder = React.useCallback(async () => {
		try {
			const revision = revisionRef.current + 1;
			revisionRef.current = revision;
			const result = await pickSharedLocalFolder();

			if (result.canceled || revisionRef.current !== revision) {
				return;
			}

			commitSharedLocalFolders([result.folder]);
		} catch (error) {
			reportLocalFolderActionError({
				error,
				fallbackMessage: "Failed to choose local folder.",
			});
		}
	}, [commitSharedLocalFolders]);
	const clearSharedLocalFolderSelection = React.useCallback(async () => {
		try {
			const revision = revisionRef.current + 1;
			revisionRef.current = revision;
			await clearSharedLocalFolder();

			if (revisionRef.current !== revision) {
				return;
			}

			commitSharedLocalFolders(EMPTY_SHARED_LOCAL_FOLDERS);
		} catch (error) {
			reportLocalFolderActionError({
				error,
				fallbackMessage: "Failed to remove local folder.",
			});
		}
	}, [commitSharedLocalFolders]);

	return {
		chooseSharedLocalFolder,
		clearSharedLocalFolderSelection,
		reconcileSharedLocalFolders: commitSharedLocalFolders,
		sharedLocalFolders: visibleFolders,
	};
};
