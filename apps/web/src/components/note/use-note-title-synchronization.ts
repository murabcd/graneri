import * as React from "react";

export const useNoteTitleSynchronization = ({
	externalTitle,
	isNoteResolved,
	noteId,
	onTitleChange,
}: {
	externalTitle?: string;
	isNoteResolved: boolean;
	noteId: string | null;
	onTitleChange?: (title: string) => void;
}) => {
	const [title, setTitleState] = React.useState("");
	const latestTitleRef = React.useRef("");
	const suppressNextTitleChangeRef = React.useRef(false);

	const setTitle = React.useCallback((nextTitle: string) => {
		latestTitleRef.current = nextTitle;
		setTitleState(nextTitle);
	}, []);

	const applyDocumentTitle = React.useCallback(
		(nextTitle: string) => {
			if (nextTitle !== latestTitleRef.current) {
				suppressNextTitleChangeRef.current = true;
				setTitle(nextTitle);
			}
			onTitleChange?.(nextTitle);
		},
		[onTitleChange, setTitle],
	);

	React.useEffect(() => {
		if (suppressNextTitleChangeRef.current) {
			suppressNextTitleChangeRef.current = false;
			return;
		}

		const timeout = window.setTimeout(() => {
			onTitleChange?.(title);
		}, 150);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [onTitleChange, title]);

	React.useEffect(() => {
		if (!noteId || !isNoteResolved || externalTitle === undefined) {
			return;
		}

		if (externalTitle === latestTitleRef.current) {
			return;
		}

		suppressNextTitleChangeRef.current = true;
		setTitle(externalTitle);
	}, [externalTitle, isNoteResolved, noteId, setTitle]);

	return {
		applyDocumentTitle,
		setTitle,
		title,
	};
};
