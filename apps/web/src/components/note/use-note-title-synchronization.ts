import * as React from "react";

type NoteTitleDraft = {
	externalTitle?: string;
	noteId: string | null;
	shouldNotify: boolean;
	title: string;
};

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
	const resolvedExternalTitle =
		noteId && isNoteResolved ? externalTitle : undefined;
	const [titleDraft, setTitleDraft] = React.useState<NoteTitleDraft | null>(
		null,
	);
	const isCurrentDraft =
		titleDraft?.noteId === noteId &&
		titleDraft.externalTitle === resolvedExternalTitle;
	const title = isCurrentDraft
		? titleDraft.title
		: (resolvedExternalTitle ?? "");

	const setTitle = React.useCallback(
		(nextTitle: string) => {
			setTitleDraft({
				externalTitle: resolvedExternalTitle,
				noteId,
				shouldNotify: true,
				title: nextTitle,
			});
		},
		[noteId, resolvedExternalTitle],
	);

	const applyDocumentTitle = React.useCallback(
		(nextTitle: string) => {
			if (nextTitle !== title) {
				setTitleDraft({
					externalTitle: resolvedExternalTitle,
					noteId,
					shouldNotify: false,
					title: nextTitle,
				});
			}
			onTitleChange?.(nextTitle);
		},
		[noteId, onTitleChange, resolvedExternalTitle, title],
	);

	React.useEffect(() => {
		if (!isCurrentDraft || !titleDraft?.shouldNotify) {
			return;
		}

		const timeout = window.setTimeout(() => {
			onTitleChange?.(title);
		}, 150);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [isCurrentDraft, onTitleChange, title, titleDraft]);

	return {
		applyDocumentTitle,
		setTitle,
		title,
	};
};
