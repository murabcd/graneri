export const rendererMeetingWidgetPathname: "/desktop/meeting-widget";
export const rendererAccessibilityGuidePathname: "/desktop/accessibility-guide";
export const rendererRoutePrefixes: readonly [
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
];
export function isRendererAppRoutePath(pathname: string): boolean;
