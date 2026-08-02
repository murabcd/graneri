class ResizeObserverMock {
	observe() {}

	unobserve() {}

	disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

for (const method of [
	"hasPointerCapture",
	"releasePointerCapture",
	"scrollIntoView",
	"setPointerCapture",
] as const) {
	if (!(method in Element.prototype)) {
		Object.defineProperty(Element.prototype, method, {
			configurable: true,
			value: method === "hasPointerCapture" ? () => false : () => undefined,
			writable: true,
		});
	}
}

const createMediaQueryList = (query: string): MediaQueryList =>
	({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}) as MediaQueryList;

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => createMediaQueryList(query),
});
