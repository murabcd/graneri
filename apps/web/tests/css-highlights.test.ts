import { afterEach, describe, expect, it, vi } from "vitest";
import { getCssHighlightApi } from "@/lib/css-highlights";

const originalCssDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"CSS",
);
const originalHighlightDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"Highlight",
);

const restoreGlobalProperty = (
	name: "CSS" | "Highlight",
	descriptor: PropertyDescriptor | undefined,
) => {
	if (descriptor) {
		Object.defineProperty(globalThis, name, descriptor);
		return;
	}

	Reflect.deleteProperty(globalThis, name);
};

afterEach(() => {
	restoreGlobalProperty("CSS", originalCssDescriptor);
	restoreGlobalProperty("Highlight", originalHighlightDescriptor);
});

describe("CSS Highlights API", () => {
	it("requires the constructor and registry", () => {
		Object.defineProperty(globalThis, "CSS", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(globalThis, "Highlight", {
			configurable: true,
			value: class MockHighlight {},
		});
		expect(getCssHighlightApi()).toBeNull();

		Object.defineProperty(globalThis, "CSS", {
			configurable: true,
			value: { highlights: new Map() },
		});
		Object.defineProperty(globalThis, "Highlight", {
			configurable: true,
			value: undefined,
		});
		expect(getCssHighlightApi()).toBeNull();
	});

	it("returns the browser-owned constructor and registry", () => {
		class MockHighlight {}
		const registry = {
			delete: vi.fn(),
			set: vi.fn(),
		};
		Object.defineProperty(globalThis, "CSS", {
			configurable: true,
			value: { highlights: registry },
		});
		Object.defineProperty(globalThis, "Highlight", {
			configurable: true,
			value: MockHighlight,
		});

		expect(getCssHighlightApi()).toEqual({
			Highlight: MockHighlight,
			registry,
		});
	});
});
