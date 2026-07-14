import { onDesktopAppCommand } from "@workspace/platform/desktop";
import type { DesktopAppCommand } from "@workspace/platform/desktop-bridge";
import * as React from "react";

type ApplicationCommandHandler = () => void;

const commandHandlers = new Map<
	DesktopAppCommand,
	Set<ApplicationCommandHandler>
>();

const registerApplicationCommand = (
	command: DesktopAppCommand,
	handler: ApplicationCommandHandler,
) => {
	const handlers = commandHandlers.get(command) ?? new Set();
	handlers.add(handler);
	commandHandlers.set(command, handlers);

	return () => {
		handlers.delete(handler);
		if (handlers.size === 0) {
			commandHandlers.delete(command);
		}
	};
};

const dispatchApplicationCommand = (command: DesktopAppCommand) => {
	for (const handler of commandHandlers.get(command) ?? []) {
		handler();
	}
};

export const useApplicationCommand = (
	command: DesktopAppCommand,
	handler: ApplicationCommandHandler,
) => {
	const handleCommand = React.useEffectEvent(handler);

	React.useEffect(
		() => registerApplicationCommand(command, handleCommand),
		[command],
	);
};

export const useDesktopApplicationCommands = () => {
	React.useEffect(() => onDesktopAppCommand(dispatchApplicationCommand), []);
};
