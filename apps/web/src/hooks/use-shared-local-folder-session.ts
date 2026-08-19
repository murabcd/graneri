import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import * as React from "react";
import { requireRehydratedSharedLocalFolders } from "@/lib/local-folder-sharing";
import { logError } from "@/lib/logger";

const EMPTY_SHARED_LOCAL_FOLDERS: DesktopLocalFolder[] = [];

type SharedLocalFolderState = {
	folders: DesktopLocalFolder[];
	storageScope: string;
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

	const reconcileSharedLocalFolders = React.useCallback(
		(folders: DesktopLocalFolder[]) => {
			revisionRef.current += 1;
			setState({ folders, storageScope });
		},
		[storageScope],
	);

	return {
		reconcileSharedLocalFolders,
		sharedLocalFolders:
			state.storageScope === storageScope
				? state.folders
				: EMPTY_SHARED_LOCAL_FOLDERS,
	};
};
