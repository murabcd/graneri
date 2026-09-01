import type { ThemeRegistrationAny } from "streamdown";
import codexDarkThemeData from "@/assets/codex-dark-code-theme.json";
import codexLightThemeData from "@/assets/codex-light-code-theme.json";

// Immutable Shiki registrations extracted from the installed ChatGPT/Codex app.
export const codexLightCodeTheme = {
	...codexLightThemeData,
	type: "light",
} satisfies ThemeRegistrationAny;

export const codexDarkCodeTheme = {
	...codexDarkThemeData,
	type: "dark",
} satisfies ThemeRegistrationAny;
