import * as React from "react";

export function useDropdownPopoverHandoff<Args extends readonly unknown[]>(
	openPopover: (...args: Args) => void,
) {
	const preventCloseAutoFocusRef = React.useRef(false);
	const pendingArgsRef = React.useRef<Args | null>(null);

	const preparePopoverOpen = React.useCallback((...args: Args) => {
		preventCloseAutoFocusRef.current = true;
		pendingArgsRef.current = args;
	}, []);

	const completePopoverOpen = React.useCallback(() => {
		const pendingArgs = pendingArgsRef.current;
		if (!pendingArgs) {
			return;
		}

		pendingArgsRef.current = null;
		openPopover(...pendingArgs);
	}, [openPopover]);

	return {
		completePopoverOpen,
		preparePopoverOpen,
		preventCloseAutoFocusRef,
	};
}
