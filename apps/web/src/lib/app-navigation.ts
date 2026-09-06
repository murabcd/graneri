export function navigateToAppLocation(location: string) {
	window.history.pushState(null, "", location);
	window.dispatchEvent(new PopStateEvent("popstate"));
}
