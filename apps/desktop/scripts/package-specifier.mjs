export const packageNameFromSpecifier = (specifier) =>
	specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];
