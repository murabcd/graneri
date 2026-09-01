import type { ThemeRegistrationAny } from "streamdown";
import graneriDarkThemeData from "@/assets/graneri-dark-code-theme.json";
import graneriLightThemeData from "@/assets/graneri-light-code-theme.json";

export const graneriLightCodeTheme = {
	...graneriLightThemeData,
	type: "light",
} satisfies ThemeRegistrationAny;

export const graneriDarkCodeTheme = {
	...graneriDarkThemeData,
	type: "dark",
} satisfies ThemeRegistrationAny;
