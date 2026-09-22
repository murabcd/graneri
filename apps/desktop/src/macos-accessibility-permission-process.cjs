const { NobjcLibrary, callFunction } = require("objc-js");

const applicationServices = new NobjcLibrary(
	"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
);

// Accessing a symbol loads the framework before resolving its C functions.
void applicationServices.AXUIElement;

process.parentPort.postMessage({
	event: "accessibility-permission-status",
	trusted: callFunction("AXIsProcessTrusted", { returns: "B" }),
});

setImmediate(() => process.exit(0));
