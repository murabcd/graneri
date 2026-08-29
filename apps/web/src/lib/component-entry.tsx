import * as React from "react";
import { ComponentEntryBoundary } from "@/lib/component-entry-boundary";

type ComponentModuleLoader<Module> = () => Promise<Module>;
type DefaultComponentModule<Props extends object> = {
	default: React.ComponentType<Props>;
};
type PreloadableComponentEntry<Props extends object> = React.FC<Props> & {
	preload: () => Promise<void>;
};

export function getOnlyComponentModule<Module>(
	modules: Record<string, ComponentModuleLoader<Module>>,
) {
	const loaders = Object.values(modules);
	const [loadModule] = loaders;

	if (loaders.length !== 1 || !loadModule) {
		throw new Error("Expected exactly one component module.");
	}

	return loadModule;
}

export function createComponentEntry<Props extends object, Module>(
	loadModule: ComponentModuleLoader<Module>,
	selectComponent: (module: Module) => React.ComponentType<Props>,
): PreloadableComponentEntry<Props> {
	let loadedComponent: React.ComponentType<Props> | null = null;
	let componentPromise: Promise<React.ComponentType<Props>> | null = null;
	const loadComponent = () => {
		componentPromise ??= loadModule()
			.then((module) => {
				const component = selectComponent(module);
				loadedComponent = component;
				return component;
			})
			.catch((error: unknown) => {
				componentPromise = null;
				throw error;
			});
		return componentPromise;
	};
	const LazyComponent = React.lazy(async () => {
		const component = await loadComponent();

		return {
			default: component,
		};
	});

	const ComponentEntry: PreloadableComponentEntry<Props> = (props) => {
		const LoadedComponent = loadedComponent;
		return (
			<ComponentEntryBoundary>
				<React.Suspense>
					{LoadedComponent ? (
						<LoadedComponent {...props} />
					) : (
						<LazyComponent {...props} />
					)}
				</React.Suspense>
			</ComponentEntryBoundary>
		);
	};
	ComponentEntry.preload = async () => {
		await loadComponent();
	};
	return ComponentEntry;
}

export function createDefaultComponentEntry<Props extends object>(
	loadModule: ComponentModuleLoader<DefaultComponentModule<Props>>,
) {
	return createComponentEntry(loadModule, (module) => module.default);
}

export function createOpenComponentEntry<
	Props extends {
		open: boolean;
	},
	Module,
>(
	loadModule: ComponentModuleLoader<Module>,
	selectComponent: (module: Module) => React.ComponentType<Props>,
) {
	const ComponentEntry = createComponentEntry(loadModule, selectComponent);

	const OpenComponentEntry: PreloadableComponentEntry<Props> = (props) => {
		if (!props.open) {
			return null;
		}

		return <ComponentEntry {...props} />;
	};
	OpenComponentEntry.preload = ComponentEntry.preload;
	return OpenComponentEntry;
}
