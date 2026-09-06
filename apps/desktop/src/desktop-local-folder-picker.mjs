export const pickDesktopLocalFolder = async ({
	authorizeFolder,
	scope,
	showOpenDialog,
}) => {
	const result = await showOpenDialog({
		buttonLabel: "Choose",
		message:
			"Graneri can read, create, and modify files in the folder you share.",
		properties: ["openDirectory", "createDirectory"],
		title: "Choose local folder",
	});
	const [folderPath] = result.filePaths;

	if (result.canceled || !folderPath) {
		return { canceled: true };
	}

	const { session } = await authorizeFolder({ path: folderPath, scope });
	return { canceled: false, session };
};
