(() => {
	const storedTheme = localStorage.getItem("theme");
	const resolvedTheme =
		storedTheme === "dark" ||
		(storedTheme !== "light" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches)
			? "dark"
			: "light";

	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(resolvedTheme);
	document.documentElement.style.colorScheme = resolvedTheme;
})();
