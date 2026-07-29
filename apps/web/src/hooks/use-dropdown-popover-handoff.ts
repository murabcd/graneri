import * as React from "react";

export function useDropdownPopoverHandoff<Value>(
	openPopover: (value: Value) => void,
) {
	const preventCloseAutoFocusRef = React.useRef(false);
	const pendingValueRef = React.useRef<{ value: Value } | null>(null);

	const preparePopoverOpen = React.useCallback((value: Value) => {
		preventCloseAutoFocusRef.current = true;
		pendingValueRef.current = { value };
	}, []);

	const completePopoverOpen = React.useCallback(() => {
		const pendingValue = pendingValueRef.current;
		if (!pendingValue) {
			return;
		}

		pendingValueRef.current = null;
		openPopover(pendingValue.value);
	}, [openPopover]);

	return {
		completePopoverOpen,
		preparePopoverOpen,
		preventCloseAutoFocusRef,
	};
}
