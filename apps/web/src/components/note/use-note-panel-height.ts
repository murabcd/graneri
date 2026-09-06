import { useEffect, useState } from "react";
import {
	clampPanelHeight,
	getCurrentPanelMaxHeight,
	getCurrentPanelViewportPlatform,
	getNoteScopedStorageKey,
	getNoteScopedStorageKeyForViewport,
	readStoredPanelHeight,
	storePanelHeight,
} from "./note-composer-panel-storage";

const readPanelHeight = (storageKey: string, defaultHeight: number) =>
	clampPanelHeight({
		nextHeight: readStoredPanelHeight(storageKey, defaultHeight),
		maxHeight: getCurrentPanelMaxHeight(),
	});

export const useNotePanelHeight = ({
	defaultHeight,
	isMobileViewport,
	noteScopeKey,
	prefix,
}: Parameters<typeof getNoteScopedStorageKeyForViewport>[0] & {
	defaultHeight: number;
}) => {
	const storageKey = getNoteScopedStorageKeyForViewport({
		isMobileViewport,
		noteScopeKey,
		prefix,
	});
	const [height, setHeight] = useState(() =>
		readPanelHeight(
			getNoteScopedStorageKey({
				noteScopeKey,
				platform: getCurrentPanelViewportPlatform(),
				prefix,
			}),
			defaultHeight,
		),
	);
	const [previousStorageKey, setPreviousStorageKey] = useState(storageKey);
	if (previousStorageKey !== storageKey) {
		setPreviousStorageKey(storageKey);
		setHeight(readPanelHeight(storageKey, defaultHeight));
	}

	useEffect(() => {
		storePanelHeight(storageKey, height);
	}, [height, storageKey]);

	return [height, setHeight] as const;
};
