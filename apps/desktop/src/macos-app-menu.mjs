import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let macOSApplication;

const getMacOSApplication = () => {
	if (process.platform !== "darwin") {
		return null;
	}

	if (!macOSApplication) {
		const { NobjcLibrary } = require("objc-js");
		const appKit = new NobjcLibrary(
			"/System/Library/Frameworks/AppKit.framework/AppKit",
		);
		macOSApplication = appKit.NSApplication.sharedApplication();
	}

	return macOSApplication;
};

const functionKeyModifierMask = 1 << 23;

const getMenuItems = (menu) => {
	const items = menu.itemArray();
	const itemCount = Number(items.count());
	const result = [];

	for (let index = 0; index < itemCount; index += 1) {
		result.push(items.objectAtIndex$(index));
	}

	return result;
};

const findMenuItem = (menu, title) =>
	getMenuItems(menu).find((item) => item.title().toString() === title) ?? null;

export const removeMacOSFullScreenMenuDuplicate = ({
	application = getMacOSApplication(),
} = {}) => {
	if (!application) {
		return false;
	}

	const mainMenu = application.mainMenu();
	const viewMenuItem = mainMenu ? findMenuItem(mainMenu, "View") : null;
	const viewMenu = viewMenuItem?.submenu();

	if (!viewMenu) {
		return false;
	}

	const fullScreenItems = getMenuItems(viewMenu).filter((item) =>
		item.title().toString().endsWith("Full Screen"),
	);
	const systemItem = fullScreenItems.find(
		(item) =>
			(Number(item.keyEquivalentModifierMask()) & functionKeyModifierMask) !==
			0,
	);

	if (!systemItem) {
		return false;
	}

	for (const item of fullScreenItems) {
		if (item !== systemItem) {
			viewMenu.removeItem$(item);
		}
	}

	return true;
};
