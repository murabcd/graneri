import assert from "node:assert/strict";
import test from "node:test";
import {
	isRendererAppRoutePath,
	rendererAccessibilityGuidePathname,
	rendererMeetingWidgetPathname,
	rendererRoutePrefixes,
} from "../../../packages/platform/src/renderer-routes.mjs";

test("renderer route manifest includes desktop and web app routes", () => {
	assert.equal(
		rendererAccessibilityGuidePathname,
		"/desktop/accessibility-guide",
	);
	assert.equal(rendererMeetingWidgetPathname, "/desktop/meeting-widget");
	assert.deepEqual(rendererRoutePrefixes, [
		"/automations",
		"/calendar",
		"/chat",
		"/desktop/accessibility-guide",
		"/desktop/meeting-widget",
		"/home",
		"/inbox",
		"/note",
		"/project",
		"/settings",
		"/shared",
	]);
});

test("renderer route predicate accepts app routes and rejects assets", () => {
	for (const pathname of [
		"/",
		"/home",
		"/calendar",
		"/chat",
		"/chat/thread",
		"/desktop/accessibility-guide",
		"/desktop/meeting-widget",
		"/project",
		"/settings/profile",
		"/shared/note",
	]) {
		assert.equal(isRendererAppRoutePath(pathname), true, pathname);
	}

	for (const pathname of [
		"/assets/index.js",
		"/favicon.ico",
		"/api/chat",
		"/desktop",
		"/settings-profile",
	]) {
		assert.equal(isRendererAppRoutePath(pathname), false, pathname);
	}
});
