import { Menu } from "electron";
import { createDesktopAppMenuTemplate } from "./desktop-app-menu-template.mjs";
import { removeMacOSFullScreenMenuDuplicate } from "./macos-app-menu.mjs";

export const createDesktopAppMenu = (options) => {
	const build = () => {
		if (process.platform !== "darwin") {
			return null;
		}

		return Menu.buildFromTemplate(createDesktopAppMenuTemplate(options));
	};

	const refresh = () => {
		if (process.platform !== "darwin") {
			return;
		}

		const menu = build();

		Menu.setApplicationMenu(menu);
		removeMacOSFullScreenMenuDuplicate();
		setImmediate(removeMacOSFullScreenMenuDuplicate);

		const viewMenu = menu.items.find((item) => item.label === "View")?.submenu;
		viewMenu?.on("menu-will-show", removeMacOSFullScreenMenuDuplicate);
	};

	return {
		refresh,
	};
};
