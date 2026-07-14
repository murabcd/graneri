export const createDesktopViewCommands = ({ appCommandChannel, getWindow }) => {
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
			return;
		}

		window.webContents.send(appCommandChannel, command);
	};

	return {
		goHome: () => {
			sendRendererCommand("go-home");
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
