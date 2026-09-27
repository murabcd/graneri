class ResizeObserverMock {
	observe() {}

	unobserve() {}

	disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

class IntersectionObserverMock implements IntersectionObserver {
	readonly root = null;
	readonly rootMargin = "0px";
	readonly thresholds = [0];

	constructor(private readonly callback: IntersectionObserverCallback) {}

	observe(target: Element) {
		const bounds = target.getBoundingClientRect();
		this.callback(
			[
				{
					boundingClientRect: bounds,
					intersectionRect: bounds,
					rootBounds: null,
					time: 0,
					target,
					isIntersecting: true,
					intersectionRatio: 1,
				},
			],
			this,
		);
	}

	unobserve() {}

	disconnect() {}

	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

globalThis.IntersectionObserver = IntersectionObserverMock;

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
