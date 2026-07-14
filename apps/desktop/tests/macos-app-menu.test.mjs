import assert from "node:assert/strict";
import test from "node:test";
import { removeMacOSFullScreenMenuDuplicate } from "../src/macos-app-menu.mjs";

const functionKeyModifierMask = 1 << 23;

const createNativeArray = (items) => ({
	count: () => items.length,
	objectAtIndex$: (index) => items[index],
});

const createMenu = (items, removedItems = []) => ({
	itemArray: () => createNativeArray(items),
	removeItem$: (item) => removedItems.push(item),
});

const createMenuItem = ({ modifierMask = 0, submenu = null, title }) => ({
	keyEquivalentModifierMask: () => modifierMask,
	submenu: () => submenu,
	title: () => ({ toString: () => title }),
});

test("keeps AppKit Function+F and removes Electron's duplicate", () => {
	const removedItems = [];
	const appKitItem = createMenuItem({
		modifierMask: functionKeyModifierMask,
		title: "Toggle Full Screen",
	});
	const electronItem = createMenuItem({ title: "Toggle Full Screen" });
	const viewMenu = createMenu([appKitItem, electronItem], removedItems);
	const mainMenu = createMenu([
		createMenuItem({ title: "Graneri" }),
		createMenuItem({ title: "View", submenu: viewMenu }),
	]);

	assert.equal(
		removeMacOSFullScreenMenuDuplicate({
			application: { mainMenu: () => mainMenu },
		}),
		true,
	);
	assert.deepEqual(removedItems, [electronItem]);
});

test("leaves the menu unchanged until AppKit supplies its item", () => {
	const removedItems = [];
	const electronItem = createMenuItem({ title: "Toggle Full Screen" });
	const viewMenu = createMenu([electronItem], removedItems);
	const mainMenu = createMenu([
		createMenuItem({ title: "View", submenu: viewMenu }),
	]);

	assert.equal(
		removeMacOSFullScreenMenuDuplicate({
			application: { mainMenu: () => mainMenu },
		}),
		false,
	);
	assert.deepEqual(removedItems, []);
});
