import {
	CHAT_MODE,
	type ChatMode,
	parseChatMode,
} from "@workspace/ai/chat-mode";
import * as React from "react";

const CHAT_MODE_STORAGE_KEY = "graneri:chat-mode";
const WEB_SEARCH_STORAGE_KEY = "graneri:chat-web-search-enabled";
type ChatComposerOptionStorage = Pick<Storage, "getItem" | "setItem">;

const getBrowserStorage = (): ChatComposerOptionStorage | null => {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		return window.localStorage;
	} catch {
		return null;
	}
};

const getStoredChatMode = (
	storage: ChatComposerOptionStorage | null,
): ChatMode => {
	try {
		return (
			parseChatMode(storage?.getItem(CHAT_MODE_STORAGE_KEY) ?? null) ??
			CHAT_MODE.DEFAULT
		);
	} catch {
		return CHAT_MODE.DEFAULT;
	}
};

const getStoredWebSearchEnabled = (
	storage: ChatComposerOptionStorage | null,
): boolean => {
	try {
		return storage?.getItem(WEB_SEARCH_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
};

const storeChatMode = (
	storage: ChatComposerOptionStorage | null,
	mode: ChatMode,
) => {
	try {
		storage?.setItem(CHAT_MODE_STORAGE_KEY, mode);
	} catch {
		// Composer controls must remain usable when browser storage is unavailable.
	}
};

const storeWebSearchEnabled = (
	storage: ChatComposerOptionStorage | null,
	enabled: boolean,
) => {
	try {
		storage?.setItem(WEB_SEARCH_STORAGE_KEY, String(enabled));
	} catch {
		// Composer controls must remain usable when browser storage is unavailable.
	}
};

export const useChatComposerOptions = (
	storage: ChatComposerOptionStorage | null = getBrowserStorage(),
) => {
	const [webSearchEnabled, setWebSearchEnabledState] = React.useState(() =>
		getStoredWebSearchEnabled(storage),
	);
	const [chatMode, setChatModeState] = React.useState(() =>
		getStoredChatMode(storage),
	);
	const setWebSearchEnabled = React.useCallback(
		(enabled: boolean) => {
			setWebSearchEnabledState(enabled);
			storeWebSearchEnabled(storage, enabled);
		},
		[storage],
	);
	const setChatMode = React.useCallback(
		(mode: ChatMode) => {
			setChatModeState(mode);
			storeChatMode(storage, mode);
		},
		[storage],
	);

	return {
		chatMode,
		setChatMode,
		setWebSearchEnabled,
		webSearchEnabled,
	};
};
