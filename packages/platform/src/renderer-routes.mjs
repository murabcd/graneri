export const rendererMeetingWidgetPathname = "/desktop/meeting-widget";
export const rendererAccessibilityGuidePathname =
	"/desktop/accessibility-guide";

export const rendererRoutePrefixes = [
	"/automations",
	"/calendar",
	"/chat",
	rendererAccessibilityGuidePathname,
	rendererMeetingWidgetPathname,
	"/home",
	"/inbox",
	"/note",
	"/project",
	"/settings",
	"/shared",
];

export const isRendererAppRoutePath = (pathname) =>
	pathname === "/" ||
	rendererRoutePrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
