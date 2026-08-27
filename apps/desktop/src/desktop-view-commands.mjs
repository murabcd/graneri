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

export const createDesktopViewCommands = ({
	appCommandChannel,
	getWindow,
	platform,
}) => {
	const getLiveWindow = () => {
		const window = getWindow();

		if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
			return null;
		}

		return window;
	};

	const sendRendererCommand = (command) => {
		const window = getLiveWindow();

		if (!window) {
			return false;
		}

		window.webContents.send(appCommandChannel, command);
		return true;
	};

	return {
		goHome: () => {
			sendRendererCommand("go-home");
		},
		handleBeforeInputEvent: (event, input) => {
			if (
				!isPrimarySelectAllShortcut(input, platform) ||
				!sendRendererCommand("select-all")
			) {
				return false;
			}

			event.preventDefault();
			return true;
		},
		navigateBack: () => {
			sendRendererCommand("navigate-back");
		},
		navigateForward: () => {
			sendRendererCommand("navigate-forward");
		},
		openSearch: () => {
			sendRendererCommand("open-search");
		},
		openAskAi: () => {
			sendRendererCommand("open-ask-ai");
		},
		reload: () => {
			getLiveWindow()?.webContents.reload();
		},
		toggleSidebar: () => {
			sendRendererCommand("toggle-sidebar");
		},
	};
};
