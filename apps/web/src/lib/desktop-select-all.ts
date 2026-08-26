const getActiveContentEditable = (activeElement: Element | null) => {
	if (!(activeElement instanceof HTMLElement)) {
		return null;
	}

	const contentEditableBoundary =
		activeElement.closest<HTMLElement>("[contenteditable]");

	if (
		!contentEditableBoundary ||
		contentEditableBoundary.contentEditable === "false"
	) {
		return null;
	}

	return contentEditableBoundary;
};

export const selectAllInActiveEditable = (selectionDocument: Document) => {
	const selection = selectionDocument.getSelection();
	selection?.removeAllRanges();

	const activeElement = selectionDocument.activeElement;

	if (
		activeElement instanceof HTMLInputElement ||
		activeElement instanceof HTMLTextAreaElement
	) {
		activeElement.select();
		return;
	}

	const contentEditable = getActiveContentEditable(activeElement);
	if (!contentEditable || !selection) {
		return;
	}

	const range = selectionDocument.createRange();
	range.selectNodeContents(contentEditable);
	selection.addRange(range);
};
