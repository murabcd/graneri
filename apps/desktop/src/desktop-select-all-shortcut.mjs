const isPrimarySelectAllShortcut = (input, platform) => {
	const usesPrimaryModifier =
		platform === "darwin"
			? input.meta && !input.control
			: input.control && !input.meta;

	return (
		input.type === "keyDown" &&
		input.key.toLowerCase() === "a" &&
		usesPrimaryModifier &&
		!input.alt &&
		!input.shift
	);
};

export const handleDesktopSelectAllShortcut = ({
	appCommandChannel,
	event,
	input,
	platform,
	webContents,
}) => {
	if (!isPrimarySelectAllShortcut(input, platform)) {
		return false;
	}

	event.preventDefault();
	webContents.send(appCommandChannel, "select-all");
	return true;
};
