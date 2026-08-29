export const pickDesktopLocalFolder = async ({
	shareLocalFolders,
	showOpenDialog,
}) => {
	const result = await showOpenDialog({
		buttonLabel: "Choose",
		properties: ["openDirectory", "createDirectory"],
		title: "Choose local folder",
	});
	const [folderPath] = result.filePaths;

	if (result.canceled || !folderPath) {
		return { canceled: true };
	}

	const { folders } = await shareLocalFolders([folderPath]);
	const [folder] = folders;

	if (!folder) {
		throw new Error("The selected local folder could not be registered.");
	}

	return { canceled: false, folder };
};
