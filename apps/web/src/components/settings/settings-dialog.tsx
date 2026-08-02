import { getCapabilitySettings } from "@workspace/ai/capability-metadata";
import { isDesktopRuntime } from "@workspace/platform/desktop";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@workspace/ui/components/input-group";
import { Label } from "@workspace/ui/components/label";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@workspace/ui/components/select";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { Switch } from "@workspace/ui/components/switch";
import { useMutation, useQuery } from "convex/react";
import {
	Bell,
	CalendarDays,
	Check,
	ChevronDown,
	Copy,
	Database,
	FolderKanban,
	ImageUp,
	LayoutGrid,
	LoaderCircle,
	Mic2,
	Paintbrush,
	SlidersHorizontal,
	UserRound,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { AppSourceIcon } from "@/components/app-source-icon";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { ConnectionDialogFooter } from "@/components/settings/connection-dialog-footer";
import { getErrorMessageWithoutTrailingPeriod as getToastErrorMessage } from "@/components/settings/connection-error-message";
import {
	calendarSettingsReducer,
	initialCalendarSettingsState,
	type JiraConnectionFormState,
	type YandexCalendarConnectionFormState,
	type YandexTrackerConnectionFormState,
	type YandexTrackerOrgType,
} from "@/components/settings/connection-settings-state";
import type { ToolConnection } from "@/components/settings/plugin-connections";
import { PluginConnectionsSection } from "@/components/settings/plugin-connections-section";
import { PreferencesSettings } from "@/components/settings/preferences-settings";
import { RemoteMcpDialog } from "@/components/settings/remote-mcp-dialog";
import { SettingsSwitchRow } from "@/components/settings/settings-switch-row";
import { useConnectedAppSettingsSession } from "@/components/settings/use-connected-app-settings-session";
import { VoiceSettings } from "@/components/settings/voice-settings";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { useLinkedAccounts } from "@/hooks/use-linked-accounts";
import { authClient } from "@/lib/auth-client";
import { getAvatarSrc } from "@/lib/avatar";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";
import {
	GOOGLE_CALENDAR_LIST_MANAGE_SCOPE,
	GOOGLE_CALENDAR_MANAGE_SCOPE,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_CALENDAR_WRITE_SCOPE,
	getGoogleLinkedAccount,
	hasGoogleScope,
} from "@/lib/google-integrations";
import { logError } from "@/lib/logger";
import {
	mergeUserPreferencesForOptimisticUpdate,
	type UserPreferencesState,
} from "@/lib/user-preferences";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type {
	SettingsDialogProps,
	SettingsPage,
	SettingsUser,
} from "./settings-types";

function useResetStateWhenValueChanges<T>(
	value: T,
	resetState: (value: T) => void,
) {
	useEffect(() => {
		resetState(value);
	}, [resetState, value]);
}

function useObjectUrlPreview(file: File | null) {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!file) {
			setPreviewUrl(null);
			return;
		}

		const nextPreviewUrl = URL.createObjectURL(file);
		setPreviewUrl(nextPreviewUrl);
		return () => URL.revokeObjectURL(nextPreviewUrl);
	}, [file]);

	return previewUrl;
}

const settingsNav = [
	{ name: "Profile", icon: UserRound },
	{ name: "Appearance", icon: Paintbrush },
	{ name: "Voice", icon: Mic2 },
	{ name: "Preferences", icon: SlidersHorizontal },
	{ name: "Notifications", icon: Bell },
	{ name: "Workspace", icon: FolderKanban },
	{ name: "Calendar", icon: CalendarDays },
	{ name: "Plugins", icon: LayoutGrid },
	{ name: "Data controls", icon: Database },
] as const;

const getSettingsNav = (isDesktopApp: boolean) =>
	isDesktopApp
		? settingsNav
		: settingsNav.filter((item) => item.name !== "Preferences");

const SETTINGS_LABEL_CLASSNAME = "text-xs text-muted-foreground";
const SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME =
	"group w-full justify-between px-0 text-sm font-medium text-foreground hover:!bg-transparent hover:text-foreground active:!bg-transparent aria-expanded:!bg-transparent aria-expanded:hover:!bg-transparent focus-visible:!bg-transparent";
const MAX_PROFILE_AVATAR_FILE_SIZE_BYTES = 5 * 1024 * 1024;

type WorkspaceFormState = {
	name: string;
	iconStorageId: Id<"_storage"> | null;
};

type ProfileFormState = {
	name: string;
	jobTitle: string;
	companyName: string;
	avatarStorageId: Id<"_storage"> | null;
};

type DataControlsState = {
	showDeleteAccountDialog: boolean;
	isDeletingAccount: boolean;
	showDeleteAllNotesDialog: boolean;
	isDeletingAllNotes: boolean;
	showDeleteAllChatsDialog: boolean;
	isDeletingAllChats: boolean;
};

type CalendarVisibilityPreferences = {
	showGoogleCalendar: boolean;
	showGoogleDrive: boolean;
	showYandexCalendar: boolean;
};

type VisibleCalendarRowProps = {
	id: string;
	icon: React.ReactNode;
	name: string;
	checked: boolean;
	disabled: boolean;
	onCheckedChange: (checked: boolean) => void;
};

const getWorkspaceFormState = (
	workspace: WorkspaceRecord | null,
): WorkspaceFormState => ({
	name: workspace?.name ?? "",
	iconStorageId: workspace?.iconStorageId ?? null,
});

const getProfileFormState = ({
	user,
	userPreferences,
}: {
	user: SettingsUser;
	userPreferences: UserPreferencesState | null | undefined;
}): ProfileFormState => ({
	name: user.name,
	jobTitle: userPreferences?.jobTitle ?? "",
	companyName: userPreferences?.companyName ?? "",
	avatarStorageId: userPreferences?.avatarStorageId ?? null,
});

const initialDataControlsState: DataControlsState = {
	showDeleteAccountDialog: false,
	isDeletingAccount: false,
	showDeleteAllNotesDialog: false,
	isDeletingAllNotes: false,
	showDeleteAllChatsDialog: false,
	isDeletingAllChats: false,
};

const navigateTo = (pathname: string) => {
	window.history.pushState(null, "", pathname);
	window.dispatchEvent(new PopStateEvent("popstate"));
};

export function SettingsDialog({
	open,
	onOpenChange,
	user,
	workspace,
	initialPage = "Profile",
	onPageChange,
	onTryPlugin,
}: SettingsDialogProps) {
	const [selectedPage, setSelectedPage] = useReducer(
		(_current: SettingsPage | null, next: SettingsPage | null) => next,
		null,
	);
	const { data: session } = authClient.useSession();
	const isDesktopApp = isDesktopRuntime();
	const activePage = selectedPage ?? initialPage;
	const navItems = getSettingsNav(isDesktopApp);

	const handlePageSelect = (page: SettingsPage) => {
		setSelectedPage(page);
		onPageChange?.(page);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				setSelectedPage(null);
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<DialogHeader className="sr-only">
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Manage your Graneri settings.</DialogDescription>
				</DialogHeader>
				<DialogDescription className="sr-only">
					Manage your Graneri settings.
				</DialogDescription>
				<SidebarProvider className="items-start">
					<Sidebar collapsible="none" className="hidden md:flex">
						<SidebarContent>
							<SidebarGroup>
								<SidebarGroupContent>
									<SidebarMenu>
										{navItems.map((item) => (
											<SidebarMenuItem key={item.name}>
												<SidebarMenuButton
													asChild
													isActive={activePage === item.name}
												>
													<button
														type="button"
														onClick={() => handlePageSelect(item.name)}
													>
														<item.icon />
														<span>{item.name}</span>
													</button>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</SidebarContent>
					</Sidebar>
					<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
						<header className="flex min-h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
							<div className="flex items-center gap-2 px-4">
								<Breadcrumb className="hidden md:block">
									<BreadcrumbList>
										<BreadcrumbItem className="hidden md:block">
											<BreadcrumbLink href="#">Settings</BreadcrumbLink>
										</BreadcrumbItem>
										<BreadcrumbSeparator className="hidden md:block" />
										<BreadcrumbItem>
											<BreadcrumbPage>{activePage}</BreadcrumbPage>
										</BreadcrumbItem>
									</BreadcrumbList>
								</Breadcrumb>
								<ScrollArea
									className="md:hidden"
									scrollbarOrientation="horizontal"
									viewportClassName="w-full"
								>
									<div className="flex w-max gap-2 py-2">
										{navItems.map((item) => (
											<Button
												key={item.name}
												variant={
													activePage === item.name ? "secondary" : "ghost"
												}
												size="sm"
												onClick={() => handlePageSelect(item.name)}
											>
												<item.icon />
												{item.name}
											</Button>
										))}
									</div>
								</ScrollArea>
							</div>
						</header>
						<ScrollArea
							className="flex flex-1"
							viewportClassName="flex flex-col gap-4 p-4 pt-0"
						>
							{activePage === "Profile" ? (
								<ManageAccountForm
									user={user}
									onCancel={() => onOpenChange(false)}
									onSave={() => onOpenChange(false)}
								/>
							) : activePage === "Appearance" ? (
								<AppearanceSettings />
							) : activePage === "Voice" ? (
								<VoiceSettings />
							) : activePage === "Preferences" ? (
								<PreferencesSettings />
							) : activePage === "Notifications" ? (
								<NotificationsSettings />
							) : activePage === "Workspace" ? (
								<WorkspaceSettings
									workspace={workspace}
									onCancel={() => onOpenChange(false)}
									onSave={() => onOpenChange(false)}
								/>
							) : activePage === "Calendar" ? (
								<CalendarSettings />
							) : activePage === "Plugins" ? (
								<ConnectionsSettings
									onClose={() => onOpenChange(false)}
									onTryPlugin={onTryPlugin}
								/>
							) : activePage === "Data controls" ? (
								<DataControlsSettings
									canDeleteData={Boolean(session?.user)}
									onClose={() => onOpenChange(false)}
								/>
							) : null}
						</ScrollArea>
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}

function NotificationsSettings() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const notificationPreferences = useQuery(
		api.notificationPreferences.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const updateNotificationPreferences = useMutation(
		api.notificationPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		localStore.setQuery(
			api.notificationPreferences.get,
			{ workspaceId: args.workspaceId },
			{
				notifyForScheduledMeetings: args.notifyForScheduledMeetings,
				notifyForAutoDetectedMeetings: args.notifyForAutoDetectedMeetings,
			},
		);
	});
	const [isSavingNotificationPreference, setIsSavingNotificationPreference] =
		useState(false);

	const handleNotificationPreferenceChange = async (preferences: {
		notifyForScheduledMeetings: boolean;
		notifyForAutoDetectedMeetings: boolean;
	}) => {
		if (!activeWorkspaceId) {
			return;
		}

		setIsSavingNotificationPreference(true);

		try {
			await updateNotificationPreferences({
				workspaceId: activeWorkspaceId,
				...preferences,
			});
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update notification preferences",
			});
			toast.error("Failed to update notification preferences");
		} finally {
			setIsSavingNotificationPreference(false);
		}
	};

	if (!activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific notification settings.
			</div>
		);
	}

	return (
		<div className="py-4">
			<FieldGroup className="gap-4">
				<SettingsSwitchRow
					id="settings-scheduled-meetings"
					label="Scheduled meetings"
					checked={notificationPreferences?.notifyForScheduledMeetings ?? false}
					disabled={isSavingNotificationPreference}
					onCheckedChange={(checked) => {
						void handleNotificationPreferenceChange({
							notifyForScheduledMeetings: checked,
							notifyForAutoDetectedMeetings:
								notificationPreferences?.notifyForAutoDetectedMeetings ?? true,
						});
					}}
				/>
				<SettingsSwitchRow
					id="settings-auto-detected-meetings"
					label="Auto-detected meetings"
					checked={
						notificationPreferences?.notifyForAutoDetectedMeetings ?? true
					}
					disabled={isSavingNotificationPreference}
					onCheckedChange={(checked) => {
						void handleNotificationPreferenceChange({
							notifyForScheduledMeetings:
								notificationPreferences?.notifyForScheduledMeetings ?? false,
							notifyForAutoDetectedMeetings: checked,
						});
					}}
				/>
			</FieldGroup>
		</div>
	);
}

function CalendarSettings() {
	const { activeWorkspaceId, visibleCalendars } =
		useCalendarSettingsController();

	if (!activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific calendar settings.
			</div>
		);
	}

	return (
		<div className="py-4">
			<VisibleCalendarsSection calendars={visibleCalendars} />
		</div>
	);
}

function useCalendarSettingsController() {
	const activeWorkspaceId = useActiveWorkspaceId();
	const { data: session } = authClient.useSession();
	const calendarPreferences = useQuery(
		api.calendarPreferences.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const updateCalendarPreferences = useMutation(
		api.calendarPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		localStore.setQuery(
			api.calendarPreferences.get,
			{ workspaceId: args.workspaceId },
			{
				showGoogleCalendar: args.showGoogleCalendar,
				showGoogleDrive: args.showGoogleDrive,
				showYandexCalendar: args.showYandexCalendar,
			},
		);
	});
	const yandexCalendarConnection = useQuery(
		api.appConnections.getYandexCalendar,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const [state, dispatch] = useReducer(
		calendarSettingsReducer,
		initialCalendarSettingsState,
	);
	const { accounts, isLoadingAccounts } = useLinkedAccounts(session?.user);
	const { isSavingCalendarPreferences } = state;

	const calendarVisibility: CalendarVisibilityPreferences = {
		showGoogleCalendar: calendarPreferences?.showGoogleCalendar ?? false,
		showGoogleDrive: calendarPreferences?.showGoogleDrive ?? false,
		showYandexCalendar: calendarPreferences?.showYandexCalendar ?? false,
	};
	const googleAccount = getGoogleLinkedAccount(accounts);
	const hasCalendarScope =
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_SCOPE) &&
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_WRITE_SCOPE) &&
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_MANAGE_SCOPE) &&
		hasGoogleScope(googleAccount, GOOGLE_CALENDAR_LIST_MANAGE_SCOPE);
	const isGoogleCalendarConnected = Boolean(googleAccount && hasCalendarScope);
	const isYandexCalendarConnected = Boolean(yandexCalendarConnection);

	const handleCalendarVisibilityChange = async (
		nextPreferences: CalendarVisibilityPreferences,
	) => {
		if (!activeWorkspaceId) {
			return;
		}

		dispatch({ type: "setIsSavingCalendarPreferences", value: true });

		try {
			await updateCalendarPreferences({
				workspaceId: activeWorkspaceId,
				...nextPreferences,
			});
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update calendar preferences",
			});
			toast.error("Failed to update calendar visibility");
		} finally {
			dispatch({ type: "setIsSavingCalendarPreferences", value: false });
		}
	};

	const visibleCalendars: VisibleCalendarRowProps[] = [
		{
			id: "visible-google-calendar",
			icon: (
				<AppSourceIcon provider="google-calendar" className="size-5 shrink-0" />
			),
			name: "Google Calendar",
			checked:
				isGoogleCalendarConnected && calendarVisibility.showGoogleCalendar,
			disabled:
				isSavingCalendarPreferences ||
				isLoadingAccounts ||
				!isGoogleCalendarConnected,
			onCheckedChange: (checked) => {
				void handleCalendarVisibilityChange({
					showGoogleCalendar: checked,
					showGoogleDrive: calendarVisibility.showGoogleDrive,
					showYandexCalendar: calendarVisibility.showYandexCalendar,
				});
			},
		},
		{
			id: "visible-yandex-calendar",
			icon: (
				<AppSourceIcon provider="yandex-calendar" className="size-5 shrink-0" />
			),
			name: "Yandex Calendar",
			checked:
				isYandexCalendarConnected && calendarVisibility.showYandexCalendar,
			disabled: isSavingCalendarPreferences || !isYandexCalendarConnected,
			onCheckedChange: (checked) => {
				void handleCalendarVisibilityChange({
					showGoogleCalendar: calendarVisibility.showGoogleCalendar,
					showGoogleDrive: calendarVisibility.showGoogleDrive,
					showYandexCalendar: checked,
				});
			},
		},
	];

	return {
		activeWorkspaceId,
		visibleCalendars,
	};
}

function VisibleCalendarsSection({
	calendars,
}: {
	calendars: VisibleCalendarRowProps[];
}) {
	return (
		<FieldGroup className="gap-6">
			<Field>
				<Label className={SETTINGS_LABEL_CLASSNAME}>Display</Label>
				<div className="space-y-4">
					{calendars.map((calendar) => (
						<CalendarVisibilityRow
							key={calendar.id}
							id={calendar.id}
							icon={calendar.icon}
							name={calendar.name}
							checked={calendar.checked}
							disabled={calendar.disabled}
							onCheckedChange={calendar.onCheckedChange}
						/>
					))}
				</div>
			</Field>
		</FieldGroup>
	);
}

function CalendarVisibilityRow({
	id,
	icon,
	name,
	checked,
	disabled,
	onCheckedChange,
}: VisibleCalendarRowProps) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-center gap-3">
				{icon}
				<Label
					htmlFor={id}
					className="min-w-0 text-sm font-medium text-foreground"
				>
					{name}
				</Label>
			</div>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}

function YandexCalendarDialog({
	open,
	onOpenChange,
	formState,
	onEmailChange,
	onPasswordChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: YandexCalendarConnectionFormState;
	onEmailChange: (email: string) => void;
	onPasswordChange: (password: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Yandex Calendar</DialogTitle>
					<DialogDescription>
						Enter the Yandex account Graneri should use to load your upcoming
						meetings.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label
							htmlFor="yandex-calendar-email"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Email
						</Label>
						<Input
							id="yandex-calendar-email"
							type="email"
							value={formState.email}
							onChange={(event) => onEmailChange(event.target.value)}
							placeholder="name@yandex.ru"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="yandex-calendar-password"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							App password
						</Label>
						<Input
							id="yandex-calendar-password"
							type="password"
							value={formState.password}
							onChange={(event) => onPasswordChange(event.target.value)}
							placeholder="Paste your Yandex app password"
						/>
					</Field>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

function ConnectionsSettings({
	onClose,
	onTryPlugin,
}: {
	onClose: () => void;
	onTryPlugin: SettingsDialogProps["onTryPlugin"];
}) {
	const controller = useConnectedAppSettingsSession();
	const handleTryNow = ({
		provider,
		sourceId,
	}: {
		provider: ChatAppSourceProvider;
		sourceId: string;
	}) => {
		onClose();
		onTryPlugin({ provider, sourceId });
	};

	if (!controller.activeWorkspaceId) {
		return (
			<div className="py-4 text-sm text-muted-foreground">
				Select a workspace to manage workspace-specific tool connections.
			</div>
		);
	}

	return (
		<div className="py-4">
			<PluginConnectionsSection
				connections={createToolConnections(controller)}
				onTryNow={handleTryNow}
			/>
			<ConnectionSettingsDialogs controller={controller} />
		</div>
	);
}

type ConnectionsSettingsController = ReturnType<
	typeof useConnectedAppSettingsSession
>;

const createToolConnections = (
	controller: ConnectionsSettingsController,
): ToolConnection[] => {
	const createRemoteConnection = ({
		provider,
		iconProvider = provider,
		session,
		onDisable,
		presentation,
	}: {
		provider: Exclude<
			ChatAppSourceProvider,
			"google-calendar" | "google-drive"
		>;
		iconProvider?: ChatAppSourceProvider;
		session: ConnectionsSettingsController["remoteMcp"][keyof ConnectionsSettingsController["remoteMcp"]];
		onDisable: () => Promise<void>;
		presentation: "plain" | "saving" | "saving-connected-only";
	}): ToolConnection => ({
		...getCapabilitySettings(provider),
		icon: <AppSourceIcon provider={iconProvider} className="size-5 shrink-0" />,
		installation:
			session.connection &&
			(presentation !== "saving-connected-only" ||
				session.connection.status === "connected")
				? {
						status: "installed",
						sourceId: session.connection.sourceId,
						provider,
						onUninstall: () => void onDisable(),
					}
				: { status: "available" },
		...(presentation !== "plain"
			? {
					buttonDisabled: session.isSaving || !controller.hasAuthenticatedUser,
					buttonIcon: session.isSaving ? (
						<LoaderCircle className="animate-spin" />
					) : null,
				}
			: {}),
		onConfigure: () => session.handleOpenChange(true),
	});

	return [
		{
			...getCapabilitySettings("google-calendar"),
			icon: (
				<AppSourceIcon provider="google-calendar" className="size-5 shrink-0" />
			),
			installation: controller.googleCalendarInstalled
				? {
						status: "installed",
						sourceId: "app:google-calendar",
						provider: "google-calendar",
					}
				: { status: "available" },
			buttonDisabled:
				controller.isConnectingGoogleCalendarTool ||
				!controller.hasAuthenticatedUser,
			buttonIcon: controller.isConnectingGoogleCalendarTool ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onConfigure: controller.handleConfigureGoogleCalendar,
		},
		{
			...getCapabilitySettings("google-drive"),
			icon: (
				<AppSourceIcon provider="google-drive" className="size-5 shrink-0" />
			),
			installation: controller.googleDriveInstalled
				? {
						status: "installed",
						sourceId: "app:google-drive",
						provider: "google-drive",
					}
				: { status: "available" },
			buttonDisabled:
				controller.isConnectingGoogleDriveTool ||
				!controller.hasAuthenticatedUser,
			buttonIcon: controller.isConnectingGoogleDriveTool ? (
				<LoaderCircle className="animate-spin" />
			) : null,
			onConfigure: controller.handleConfigureGoogleDrive,
		},
		{
			...getCapabilitySettings("yandex-calendar"),
			icon: (
				<AppSourceIcon provider="yandex-calendar" className="size-5 shrink-0" />
			),
			installation: controller.yandexCalendarConnection
				? {
						status: "installed",
						sourceId: controller.yandexCalendarConnection.sourceId,
						provider: "yandex-calendar",
						onUninstall: () => void controller.handleDisableYandexCalendar(),
					}
				: { status: "available" },
			buttonDisabled:
				!controller.hasAuthenticatedUser ||
				controller.isSavingYandexCalendarConnection,
			onConfigure: () => controller.handleYandexCalendarDialogOpenChange(true),
		},
		{
			...getCapabilitySettings("yandex-tracker"),
			icon: (
				<AppSourceIcon provider="yandex-tracker" className="size-5 shrink-0" />
			),
			installation: controller.yandexTrackerConnection
				? {
						status: "installed",
						sourceId: controller.yandexTrackerConnection.sourceId,
						provider: "yandex-tracker",
						onUninstall: () => void controller.handleDisableYandexTracker(),
					}
				: { status: "available" },
			onConfigure: () => controller.handleYandexTrackerDialogOpenChange(true),
		},
		createRemoteConnection({
			provider: "jira-mcp",
			iconProvider: "jira",
			session: controller.remoteMcp.jira,
			onDisable: controller.handleDisableJiraMcp,
			presentation: "saving",
		}),
		{
			...getCapabilitySettings("jira"),
			icon: <AppSourceIcon provider="jira" className="size-5 shrink-0" />,
			installation: controller.jiraConnection
				? {
						status: "installed",
						sourceId: controller.jiraConnection.sourceId,
						provider: "jira",
						onUninstall: () => void controller.handleDisableJiraSync(),
					}
				: { status: "available" },
			onConfigure: () => controller.handleJiraDialogOpenChange(true),
		},
		createRemoteConnection({
			provider: "posthog",
			session: controller.remoteMcp.posthog,
			onDisable: controller.handleDisablePostHog,
			presentation: "plain",
		}),
		createRemoteConnection({
			provider: "context7",
			session: controller.remoteMcp.context7,
			onDisable: controller.handleDisableContext7,
			presentation: "saving",
		}),
		createRemoteConnection({
			provider: "figma",
			session: controller.remoteMcp.figma,
			onDisable: controller.handleDisableFigma,
			presentation: "saving",
		}),
		createRemoteConnection({
			provider: "linear",
			session: controller.remoteMcp.linear,
			onDisable: controller.handleDisableLinear,
			presentation: "saving",
		}),
		createRemoteConnection({
			provider: "notion",
			session: controller.remoteMcp.notion,
			onDisable: controller.handleDisableNotion,
			presentation: "plain",
		}),
		createRemoteConnection({
			provider: "zoom",
			session: controller.remoteMcp.zoom,
			onDisable: controller.handleDisableZoom,
			presentation: "saving-connected-only",
		}),
	];
};

function ConnectionSettingsDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<CalendarTrackerDialogs controller={controller} />
			<JiraConnectionDialogs controller={controller} />
			<RemoteHeaderMcpConnectionDialogs controller={controller} />
			<OAuthMcpConnectionDialogs controller={controller} />
		</>
	);
}

function CalendarTrackerDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	return (
		<>
			<YandexCalendarDialog
				open={controller.isYandexCalendarDialogOpen}
				onOpenChange={controller.handleYandexCalendarDialogOpenChange}
				formState={controller.yandexCalendarFormState}
				onEmailChange={controller.setYandexCalendarEmail}
				onPasswordChange={controller.setYandexCalendarPassword}
				onConnect={() => void controller.handleConnectYandexCalendar()}
				onDisable={
					controller.yandexCalendarConnection
						? controller.handleDisableYandexCalendar
						: undefined
				}
				isFormValid={controller.isYandexCalendarFormValid}
				isSaving={controller.isSavingYandexCalendarConnection}
				isDisabling={controller.isDisablingConnection}
			/>
			<YandexTrackerDialog
				open={controller.isYandexTrackerDialogOpen}
				onOpenChange={controller.handleYandexTrackerDialogOpenChange}
				formState={controller.yandexTrackerFormState}
				onOrgTypeChange={controller.setYandexTrackerOrgType}
				onOrgIdChange={controller.setYandexTrackerOrgId}
				onTokenChange={controller.setYandexTrackerToken}
				onConnect={() => void controller.handleConnectYandexTracker()}
				onDisable={
					controller.yandexTrackerConnection
						? controller.handleDisableYandexTracker
						: undefined
				}
				isFormValid={controller.isYandexTrackerFormValid}
				isSaving={controller.isSavingYandexTrackerConnection}
				isDisabling={controller.isDisablingConnection}
			/>
		</>
	);
}

function JiraConnectionDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	const jiraMcp = controller.remoteMcp.jira;

	return (
		<>
			<JiraDialog
				open={controller.isJiraDialogOpen}
				onOpenChange={controller.handleJiraDialogOpenChange}
				formState={controller.jiraFormState}
				onBaseUrlChange={controller.setJiraBaseUrl}
				onEmailChange={controller.setJiraEmail}
				onTokenChange={controller.setJiraToken}
				onConnect={() => void controller.handleConnectJira()}
				canConnect={controller.isJiraFormValid}
				connectionStatus={
					controller.isDisablingConnection
						? "disabling"
						: controller.isSavingJiraConnection
							? "saving"
							: "idle"
				}
				onDisable={
					controller.jiraConnection
						? controller.handleDisableJiraSync
						: undefined
				}
				onCopyWebhookUrl={() => void controller.handleCopyJiraWebhookUrl()}
				showSyncSettings={Boolean(controller.jiraConnection)}
				webhookUrl={controller.jiraWebhookUrl}
			/>
			<RemoteMcpDialog
				open={jiraMcp.isOpen}
				onOpenChange={jiraMcp.handleOpenChange}
				idPrefix="jira-mcp"
				title="Connect Jira"
				description="Enter the Jira MCP connection details Graneri should use for AI tools."
				keyPlaceholder="key"
				formState={jiraMcp.formState}
				onNameChange={jiraMcp.setName}
				onBaseUrlChange={jiraMcp.setBaseUrl}
				onAddEnvVar={jiraMcp.addEnvVar}
				onRemoveEnvVar={jiraMcp.removeEnvVar}
				onUpdateEnvVar={jiraMcp.updateEnvVar}
				onOAuthClientIdChange={jiraMcp.setOAuthClientId}
				onOAuthClientSecretChange={jiraMcp.setOAuthClientSecret}
				onConnect={() => void jiraMcp.handleConnect()}
				isFormValid={jiraMcp.isFormValid}
				isSaving={jiraMcp.isSaving}
				isDisabling={controller.isDisablingConnection}
				onDisable={
					jiraMcp.connection ? controller.handleDisableJiraMcp : undefined
				}
			/>
		</>
	);
}

function RemoteHeaderMcpConnectionDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	const { context7, figma, linear } = controller.remoteMcp;

	return (
		<>
			<RemoteMcpDialog
				open={context7.isOpen}
				onOpenChange={context7.handleOpenChange}
				idPrefix="context7-mcp"
				title="Connect Context7"
				description="Enter the Context7 MCP connection details Graneri should use for library documentation."
				keyPlaceholder="CONTEXT7_API_KEY"
				formState={context7.formState}
				onNameChange={context7.setName}
				onBaseUrlChange={context7.setBaseUrl}
				onAddEnvVar={context7.addEnvVar}
				onRemoveEnvVar={context7.removeEnvVar}
				onUpdateEnvVar={context7.updateEnvVar}
				onConnect={() => void context7.handleConnect()}
				onDisable={
					context7.connection ? controller.handleDisableContext7 : undefined
				}
				isFormValid={context7.isFormValid}
				isSaving={context7.isSaving}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={figma.isOpen}
				onOpenChange={figma.handleOpenChange}
				idPrefix="figma-mcp"
				title="Connect Figma"
				description="Enter the Figma MCP connection details Graneri should use for design context."
				keyPlaceholder="Authorization"
				formState={figma.formState}
				onNameChange={figma.setName}
				onBaseUrlChange={figma.setBaseUrl}
				onAddEnvVar={figma.addEnvVar}
				onRemoveEnvVar={figma.removeEnvVar}
				onUpdateEnvVar={figma.updateEnvVar}
				oauthClientId={figma.formState.oauthClientId}
				oauthClientSecret={figma.formState.oauthClientSecret}
				onOAuthClientIdChange={figma.setOAuthClientId}
				onOAuthClientSecretChange={figma.setOAuthClientSecret}
				onConnect={() => void figma.handleConnect()}
				onDisable={figma.connection ? controller.handleDisableFigma : undefined}
				isFormValid={figma.isFormValid}
				isSaving={figma.isSaving}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={linear.isOpen}
				onOpenChange={linear.handleOpenChange}
				idPrefix="linear-mcp"
				title="Connect Linear"
				description="Enter the Linear MCP connection details Graneri should use for issue and project context."
				keyPlaceholder="Authorization"
				formState={linear.formState}
				onNameChange={linear.setName}
				onBaseUrlChange={linear.setBaseUrl}
				onAddEnvVar={linear.addEnvVar}
				onRemoveEnvVar={linear.removeEnvVar}
				onUpdateEnvVar={linear.updateEnvVar}
				oauthClientId={linear.formState.oauthClientId}
				oauthClientSecret={linear.formState.oauthClientSecret}
				onOAuthClientIdChange={linear.setOAuthClientId}
				onOAuthClientSecretChange={linear.setOAuthClientSecret}
				onConnect={() => void linear.handleConnect()}
				onDisable={
					linear.connection ? controller.handleDisableLinear : undefined
				}
				isFormValid={linear.isFormValid}
				isSaving={linear.isSaving}
				isDisabling={controller.isDisablingConnection}
			/>
		</>
	);
}

function OAuthMcpConnectionDialogs({
	controller,
}: {
	controller: ConnectionsSettingsController;
}) {
	const { notion, posthog, zoom } = controller.remoteMcp;

	return (
		<>
			<RemoteMcpDialog
				open={posthog.isOpen}
				onOpenChange={posthog.handleOpenChange}
				idPrefix="posthog-mcp"
				title="Connect PostHog"
				description="Enter the PostHog MCP connection details Graneri should use for product analytics context."
				keyPlaceholder="key"
				formState={posthog.formState}
				onNameChange={posthog.setName}
				onBaseUrlChange={posthog.setBaseUrl}
				onAddEnvVar={posthog.addEnvVar}
				onRemoveEnvVar={posthog.removeEnvVar}
				onUpdateEnvVar={posthog.updateEnvVar}
				onOAuthClientIdChange={posthog.setOAuthClientId}
				onOAuthClientSecretChange={posthog.setOAuthClientSecret}
				onConnect={() => void posthog.handleConnect()}
				onDisable={
					posthog.connection ? controller.handleDisablePostHog : undefined
				}
				isFormValid={posthog.isFormValid}
				isSaving={posthog.isSaving}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={notion.isOpen}
				onOpenChange={notion.handleOpenChange}
				idPrefix="notion-mcp"
				title="Connect Notion"
				description="Enter the Notion MCP connection details Graneri should use for workspace context."
				keyPlaceholder="key"
				formState={notion.formState}
				onNameChange={notion.setName}
				onBaseUrlChange={notion.setBaseUrl}
				onAddEnvVar={notion.addEnvVar}
				onRemoveEnvVar={notion.removeEnvVar}
				onUpdateEnvVar={notion.updateEnvVar}
				onOAuthClientIdChange={notion.setOAuthClientId}
				onOAuthClientSecretChange={notion.setOAuthClientSecret}
				onConnect={() => void notion.handleConnect()}
				onDisable={
					notion.connection ? controller.handleDisableNotion : undefined
				}
				isFormValid={notion.isFormValid}
				isSaving={notion.isSaving}
				isDisabling={controller.isDisablingConnection}
			/>
			<RemoteMcpDialog
				open={zoom.isOpen}
				onOpenChange={zoom.handleOpenChange}
				idPrefix="zoom-mcp"
				title="Connect Zoom"
				description="Enter the Zoom MCP connection details Graneri should use for meeting context."
				keyPlaceholder="key"
				formState={zoom.formState}
				onNameChange={zoom.setName}
				onBaseUrlChange={zoom.setBaseUrl}
				onAddEnvVar={zoom.addEnvVar}
				onRemoveEnvVar={zoom.removeEnvVar}
				onUpdateEnvVar={zoom.updateEnvVar}
				onOAuthClientIdChange={zoom.setOAuthClientId}
				onOAuthClientSecretChange={zoom.setOAuthClientSecret}
				onConnect={() => void zoom.handleConnect()}
				onDisable={zoom.connection ? controller.handleDisableZoom : undefined}
				isFormValid={zoom.isFormValid}
				isSaving={zoom.isSaving}
				isDisabling={controller.isDisablingConnection}
			/>
		</>
	);
}

function JiraSyncSection({
	onCopyWebhookUrl,
	webhookUrl,
}: {
	onCopyWebhookUrl: () => void;
	webhookUrl: string | null;
}) {
	const [isCopied, setIsCopied] = useState(false);

	return (
		<FieldGroup className="gap-4">
			<Field>
				<Label className={SETTINGS_LABEL_CLASSNAME}>Webhook URL</Label>
				<InputGroup>
					<InputGroupInput
						value={webhookUrl ?? "Preparing Jira mention sync..."}
						readOnly
						disabled={!webhookUrl}
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							aria-label="Copy webhook URL"
							title="Copy webhook URL"
							size="icon-xs"
							onClick={() => {
								if (!webhookUrl) {
									return;
								}

								onCopyWebhookUrl();
								setIsCopied(true);
								window.setTimeout(() => {
									setIsCopied(false);
								}, 1200);
							}}
							disabled={!webhookUrl}
						>
							{isCopied ? <Check /> : <Copy />}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</Field>
		</FieldGroup>
	);
}

function YandexTrackerDialog({
	open,
	onOpenChange,
	formState,
	onOrgTypeChange,
	onOrgIdChange,
	onTokenChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: YandexTrackerConnectionFormState;
	onOrgTypeChange: (orgType: YandexTrackerOrgType) => void;
	onOrgIdChange: (orgId: string) => void;
	onTokenChange: (token: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Yandex Tracker</DialogTitle>
					<DialogDescription>
						Enter the credentials Graneri should use for your Tracker
						connection.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<FieldContent>
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Organization type
							</Label>
						</FieldContent>
						<Select
							value={formState.orgType}
							onValueChange={(value) =>
								onOrgTypeChange(value as YandexTrackerOrgType)
							}
						>
							<SelectTrigger
								size="sm"
								className="w-full cursor-pointer justify-between"
								aria-label="Select Yandex Tracker organization type"
							>
								<span>
									{formState.orgType === "x-org-id"
										? "Yandex 360"
										: "Yandex Cloud"}
								</span>
							</SelectTrigger>
							<SelectContent align="end">
								<SelectItem value="x-org-id">Yandex 360</SelectItem>
								<SelectItem value="x-cloud-org-id">Yandex Cloud</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<Label
							htmlFor="yandex-tracker-org-id"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Organization ID
						</Label>
						<Input
							id="yandex-tracker-org-id"
							value={formState.orgId}
							onChange={(event) => onOrgIdChange(event.target.value)}
							placeholder="1234567"
						/>
					</Field>
					<Field>
						<Label
							htmlFor="yandex-tracker-token"
							className={SETTINGS_LABEL_CLASSNAME}
						>
							OAuth token
						</Label>
						<Input
							id="yandex-tracker-token"
							type="password"
							value={formState.token}
							onChange={(event) => onTokenChange(event.target.value)}
							placeholder="y0_AgAAAA..."
						/>
					</Field>
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}

// Private settings dialog with independent connection state flags; variants would obscure the form state.
function JiraDialog({
	open,
	onOpenChange,
	formState,
	onCopyWebhookUrl,
	onBaseUrlChange,
	onEmailChange,
	onTokenChange,
	onConnect,
	onDisable,
	canConnect,
	connectionStatus,
	showSyncSettings,
	webhookUrl,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	formState: JiraConnectionFormState;
	onCopyWebhookUrl: () => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onEmailChange: (email: string) => void;
	onTokenChange: (token: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	canConnect: boolean;
	connectionStatus: "idle" | "saving" | "disabling";
	showSyncSettings: boolean;
	webhookUrl: string | null;
}) {
	const isSaving = connectionStatus === "saving";
	const isDisabling = connectionStatus === "disabling";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect Jira Sync</DialogTitle>
					<DialogDescription>
						Enter the Jira API credentials Graneri should use for mention sync.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label htmlFor="jira-base-url" className={SETTINGS_LABEL_CLASSNAME}>
							Jira URL
						</Label>
						<Input
							id="jira-base-url"
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder="https://your-team.atlassian.net"
						/>
					</Field>
					<Field>
						<Label htmlFor="jira-email" className={SETTINGS_LABEL_CLASSNAME}>
							Email
						</Label>
						<Input
							id="jira-email"
							type="email"
							value={formState.email}
							onChange={(event) => onEmailChange(event.target.value)}
							placeholder="name@company.com"
						/>
					</Field>
					<Field>
						<Label htmlFor="jira-token" className={SETTINGS_LABEL_CLASSNAME}>
							API token
						</Label>
						<Input
							id="jira-token"
							type="password"
							value={formState.token}
							onChange={(event) => onTokenChange(event.target.value)}
							placeholder="ATATT..."
						/>
					</Field>
				</FieldGroup>
				{showSyncSettings ? (
					<Collapsible className="mt-4">
						<CollapsibleTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
							>
								Sync settings
								<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="pt-4">
							<JiraSyncSection
								onCopyWebhookUrl={onCopyWebhookUrl}
								webhookUrl={webhookUrl}
							/>
						</CollapsibleContent>
					</Collapsible>
				) : null}
				<div className="flex items-center justify-between gap-2 pt-2">
					{onDisable ? (
						<Button
							type="button"
							variant="destructive"
							onClick={onDisable}
							disabled={isSaving || isDisabling}
						>
							{isDisabling ? (
								<>
									<LoaderCircle className="animate-spin" />
									Disabling
								</>
							) : (
								"Disable"
							)}
						</Button>
					) : (
						<span />
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isSaving || isDisabling}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={onConnect}
							disabled={!canConnect || isSaving || isDisabling}
						>
							{isSaving ? (
								<>
									<LoaderCircle className="animate-spin" />
									Connecting
								</>
							) : (
								"Connect"
							)}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function WorkspaceSettings({
	workspace,
	onCancel,
	onSave,
}: {
	workspace: WorkspaceRecord | null;
	onCancel: () => void;
	onSave: () => void;
}) {
	const generateIconUploadUrl = useMutation(
		api.workspaces.generateIconUploadUrl,
	);
	const updateWorkspace = useMutation(api.workspaces.update);
	const [formState, setFormState] = useReducer(
		(
			current: WorkspaceFormState,
			next:
				| WorkspaceFormState
				| ((current: WorkspaceFormState) => WorkspaceFormState),
		) => (typeof next === "function" ? next(current) : next),
		workspace,
		getWorkspaceFormState,
	);
	const [isSaving, setIsSaving] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const [isUploadingIcon, setIsUploadingIcon] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const [iconPreviewFile, setIconPreviewFile] = useState<File | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { name, iconStorageId } = formState;
	const iconPreviewUrl = useObjectUrlPreview(iconPreviewFile);
	const resetWorkspaceFormState = useCallback(
		(nextWorkspace: typeof workspace) => {
			setIconPreviewFile(null);
			setFormState(getWorkspaceFormState(nextWorkspace));
		},
		[],
	);

	useResetStateWhenValueChanges(workspace, resetWorkspaceFormState);

	if (!workspace) {
		return (
			<div className="py-4">
				<FieldGroup>
					<Field>
						<Label className={SETTINGS_LABEL_CLASSNAME}>
							No workspace selected
						</Label>
						<FieldDescription>
							Select a workspace from the sidebar, then reopen settings to edit
							it here.
						</FieldDescription>
					</Field>
				</FieldGroup>
			</div>
		);
	}

	const trimmedName = name.trim();
	const hasChanges =
		trimmedName !== workspace.name ||
		iconStorageId !== (workspace.iconStorageId ?? null);
	const workspaceAvatarSrc = getAvatarSrc({
		avatar: iconPreviewUrl ?? workspace.iconUrl,
		name: trimmedName || workspace.name,
	});
	const handleCancel = () => {
		if (isSaving || isUploadingIcon) {
			return;
		}

		if (hasChanges) {
			setIconPreviewFile(null);
			setFormState(getWorkspaceFormState(workspace));
		}

		onCancel();
	};

	const handleUpload = async (file: File) => {
		setIsUploadingIcon(true);

		try {
			const uploadUrl = await generateIconUploadUrl();
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: {
					"Content-Type": file.type || "application/octet-stream",
				},
				body: file,
			});

			if (!response.ok) {
				throw new Error("Failed to upload workspace icon.");
			}

			const result = (await response.json()) as { storageId?: Id<"_storage"> };

			if (!result.storageId) {
				throw new Error("Workspace icon upload did not return a storage id.");
			}

			setIconPreviewFile(file);
			setFormState((currentState) => ({
				...currentState,
				iconStorageId: result.storageId ?? null,
			}));
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to upload workspace icon",
			});
			toast.error(
				getToastErrorMessage(error, "Failed to upload workspace icon"),
			);
		} finally {
			setIsUploadingIcon(false);
		}
	};

	const handleSubmit = async () => {
		if (!trimmedName || isSaving || isUploadingIcon || !hasChanges) {
			return;
		}

		setIsSaving(true);

		try {
			await updateWorkspace({
				workspaceId: workspace._id,
				name: trimmedName,
				iconStorageId:
					iconStorageId !== (workspace.iconStorageId ?? null)
						? (iconStorageId ?? undefined)
						: undefined,
			});
			toast.success("Workspace settings updated");
			onSave();
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to update workspace",
			});
			toast.error(getToastErrorMessage(error, "Failed to update workspace"));
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Icon</Label>
					<div className="flex items-center gap-4">
						<Avatar className="size-20 rounded-lg border">
							<AvatarImage
								src={workspaceAvatarSrc}
								alt="Workspace icon preview"
								className="object-cover"
							/>
							<AvatarFallback className="rounded-lg bg-muted/40">
								<ImageUp className="size-8 text-muted-foreground" />
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col gap-2">
							<Button
								variant="outline"
								size="sm"
								className="w-min"
								aria-label="Upload workspace icon"
								onClick={() => fileInputRef.current?.click()}
								disabled={isSaving || isUploadingIcon}
							>
								{isUploadingIcon ? "Uploading..." : "Upload"}
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								aria-label="Upload workspace icon file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								className="hidden"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (!file) {
										return;
									}

									void handleUpload(file);
									event.target.value = "";
								}}
							/>
							<FieldDescription>
								Recommend size 1:1, up to 5MB.
							</FieldDescription>
						</div>
					</div>
				</Field>
				<Field>
					<Label
						htmlFor="settings-workspace-name"
						className={SETTINGS_LABEL_CLASSNAME}
					>
						Name
					</Label>
					<Input
						id="settings-workspace-name"
						value={name}
						onChange={(event) =>
							setFormState((currentState) => ({
								...currentState,
								name: event.target.value,
							}))
						}
						placeholder="My workspace"
						disabled={isSaving}
					/>
				</Field>
			</FieldGroup>
			<div className="flex justify-end gap-2 pt-6">
				<Button
					variant="ghost"
					onClick={handleCancel}
					disabled={isSaving || isUploadingIcon}
				>
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					disabled={!trimmedName || !hasChanges || isSaving || isUploadingIcon}
				>
					{isSaving ? (
						<>
							<LoaderCircle className="animate-spin" />
							Saving
						</>
					) : (
						"Save"
					)}
				</Button>
			</div>
		</div>
	);
}

function DataControlsSettings({
	canDeleteData,
	onClose,
}: {
	canDeleteData: boolean;
	onClose: () => void;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [state, setState] = useReducer(
		(
			current: DataControlsState,
			next:
				| DataControlsState
				| ((current: DataControlsState) => DataControlsState),
		) => (typeof next === "function" ? next(current) : next),
		initialDataControlsState,
	);
	const removeAllNotes = useMutation(api.notes.removeAll);
	const removeAllChats = useMutation(api.chats.removeAll);
	const removeWorkspace = useMutation(api.workspaces.remove);
	const [showDeleteWorkspaceDialog, setShowDeleteWorkspaceDialog] =
		useState(false);
	const [isDeletingWorkspace, setIsDeletingWorkspace] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);
	const {
		showDeleteAccountDialog,
		isDeletingAccount,
		showDeleteAllNotesDialog,
		isDeletingAllNotes,
		showDeleteAllChatsDialog,
		isDeletingAllChats,
	} = state;

	const handleDeleteAccount = async () => {
		setState((currentState) => ({
			...currentState,
			isDeletingAccount: true,
		}));

		try {
			await authClient.$fetch("/delete-user", {
				method: "POST",
				throw: true,
				body: { callbackURL: "/" },
			});
			setState((currentState) => ({
				...currentState,
				showDeleteAccountDialog: false,
			}));
			onClose();
			window.location.assign("/");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete account",
			});
			setState((currentState) => ({
				...currentState,
				showDeleteAccountDialog: false,
			}));
			toast.error("Failed to delete account");
		} finally {
			setState((currentState) => ({
				...currentState,
				isDeletingAccount: false,
			}));
		}
	};

	const handleDeleteWorkspace = async () => {
		if (!activeWorkspaceId || isDeletingWorkspace) {
			return;
		}

		setIsDeletingWorkspace(true);

		try {
			await removeWorkspace({ workspaceId: activeWorkspaceId });
			setShowDeleteWorkspaceDialog(false);
			onClose();
			navigateTo("/home");
			toast.success("Workspace deleted");
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete workspace",
			});
			setShowDeleteWorkspaceDialog(false);
			toast.error(getToastErrorMessage(error, "Failed to delete workspace"));
		} finally {
			setIsDeletingWorkspace(false);
		}
	};

	const handleDeleteAllNotes = async () => {
		setState((currentState) => ({
			...currentState,
			isDeletingAllNotes: true,
		}));

		try {
			if (!activeWorkspaceId) {
				return;
			}

			const result = await removeAllNotes({ workspaceId: activeWorkspaceId });
			setState((currentState) => ({
				...currentState,
				showDeleteAllNotesDialog: false,
			}));
			onClose();
			navigateTo("/home");
			toast.success(
				result.hasMore ? "Note deletion started" : "All notes deleted",
			);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete all notes",
			});
			setState((currentState) => ({
				...currentState,
				showDeleteAllNotesDialog: false,
			}));
			toast.error("Failed to delete all notes");
		} finally {
			setState((currentState) => ({
				...currentState,
				isDeletingAllNotes: false,
			}));
		}
	};

	const handleDeleteAllChats = async () => {
		setState((currentState) => ({
			...currentState,
			isDeletingAllChats: true,
		}));

		try {
			if (!activeWorkspaceId) {
				return;
			}

			const result = await removeAllChats({ workspaceId: activeWorkspaceId });
			setState((currentState) => ({
				...currentState,
				showDeleteAllChatsDialog: false,
			}));
			onClose();
			navigateTo("/home");
			toast.success(
				result.hasMore ? "Chat deletion started" : "All chats deleted",
			);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to delete all chats",
			});
			setState((currentState) => ({
				...currentState,
				showDeleteAllChatsDialog: false,
			}));
			toast.error("Failed to delete all chats");
		} finally {
			setState((currentState) => ({
				...currentState,
				isDeletingAllChats: false,
			}));
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Workspace</Label>
					<DataControlAction
						title="Delete all notes"
						buttonLabel={isDeletingAllNotes ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteAllNotesDialog}
						onDialogOpenChange={(open) => {
							setState((currentState) => ({
								...currentState,
								showDeleteAllNotesDialog: open,
							}));
						}}
						onConfirm={handleDeleteAllNotes}
						confirmDisabled={isDeletingAllNotes}
						buttonDisabled={isDeletingAllNotes || !canDeleteData}
						dialogDescription="This action cannot be undone. All notes you own will be permanently deleted."
					/>
					<DataControlAction
						title="Delete all chats"
						buttonLabel={isDeletingAllChats ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteAllChatsDialog}
						onDialogOpenChange={(open) => {
							setState((currentState) => ({
								...currentState,
								showDeleteAllChatsDialog: open,
							}));
						}}
						onConfirm={handleDeleteAllChats}
						confirmDisabled={isDeletingAllChats}
						buttonDisabled={isDeletingAllChats || !canDeleteData}
						dialogDescription="This action cannot be undone. All chats you own will be permanently deleted."
					/>
					<DataControlAction
						title="Delete workspace"
						buttonLabel={isDeletingWorkspace ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteWorkspaceDialog}
						onDialogOpenChange={setShowDeleteWorkspaceDialog}
						onConfirm={handleDeleteWorkspace}
						confirmDisabled={isDeletingWorkspace}
						buttonDisabled={isDeletingWorkspace || !canDeleteData}
						dialogDescription="This action cannot be undone. The current workspace and its notes and chats will be permanently deleted."
					/>
				</Field>
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Account</Label>
					<DataControlAction
						title="Delete account"
						buttonLabel={isDeletingAccount ? "Deleting..." : "Delete"}
						dialogOpen={showDeleteAccountDialog}
						onDialogOpenChange={(open) => {
							setState((currentState) => ({
								...currentState,
								showDeleteAccountDialog: open,
							}));
						}}
						onConfirm={handleDeleteAccount}
						confirmDisabled={isDeletingAccount}
						buttonDisabled={isDeletingAccount || !canDeleteData}
						dialogDescription="This action cannot be undone. This will permanently delete your account."
					/>
				</Field>
			</FieldGroup>
		</div>
	);
}

function DataControlAction({
	title,
	buttonLabel,
	dialogOpen,
	onDialogOpenChange,
	onConfirm,
	confirmDisabled,
	buttonDisabled,
	dialogDescription,
}: {
	title: string;
	buttonLabel: string;
	dialogOpen: boolean;
	onDialogOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	confirmDisabled: boolean;
	buttonDisabled: boolean;
	dialogDescription: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="text-sm font-medium">{title}</div>
			<AlertDialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
				<AlertDialogTrigger asChild>
					<Button
						variant="ghost"
						className="shrink-0 bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
						disabled={buttonDisabled}
					>
						{buttonLabel}
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={confirmDisabled}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
							onClick={onConfirm}
							disabled={confirmDisabled}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function useManageAccountFormElement({
	user,
	onCancel,
	onSave,
}: {
	user: SettingsUser;
	onCancel: () => void;
	onSave: () => void;
}) {
	const userPreferences = useQuery(api.userPreferences.get, {});
	const generateAvatarUploadUrl = useMutation(
		api.userPreferences.generateAvatarUploadUrl,
	);
	const updateUserPreferences = useMutation(
		api.userPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		const currentPreferences = localStore.getQuery(api.userPreferences.get, {});
		localStore.setQuery(
			api.userPreferences.get,
			{},
			mergeUserPreferencesForOptimisticUpdate(currentPreferences, args),
		);
	});
	const [formState, setFormState] = useState<ProfileFormState>(() =>
		getProfileFormState({
			user,
			userPreferences: null,
		}),
	);
	const [avatarPreviewFile, setAvatarPreviewFile] = useState<File | null>(null);
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
	const [isSavingPreferences, setIsSavingPreferences] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const avatarPreviewUrl = useObjectUrlPreview(avatarPreviewFile);
	const profileFormSource = useMemo(
		() => [user, userPreferences] as const,
		[user, userPreferences],
	);
	const resetProfileFormState = useCallback(
		([nextUser, nextUserPreferences]: typeof profileFormSource) => {
			setAvatarPreviewFile(null);
			setFormState(
				getProfileFormState({
					user: nextUser,
					userPreferences: nextUserPreferences,
				}),
			);
		},
		[],
	);

	useResetStateWhenValueChanges(profileFormSource, resetProfileFormState);

	const trimmedName = formState.name.trim();
	const trimmedJobTitle = formState.jobTitle.trim();
	const trimmedCompanyName = formState.companyName.trim();
	const currentJobTitle = userPreferences?.jobTitle ?? "";
	const currentCompanyName = userPreferences?.companyName ?? "";
	const currentAvatarStorageId = userPreferences?.avatarStorageId ?? null;
	const hasAuthChanges = trimmedName !== user.name.trim();
	const hasPreferenceChanges =
		trimmedJobTitle !== currentJobTitle.trim() ||
		trimmedCompanyName !== currentCompanyName.trim() ||
		formState.avatarStorageId !== currentAvatarStorageId;
	const hasChanges = hasAuthChanges || hasPreferenceChanges;

	const initials = getInitials(formState.name, user.email);
	const avatarSrc = getAvatarSrc({
		avatar: avatarPreviewUrl ?? user.avatar,
		name: formState.name,
		email: user.email,
	});
	const handleCancel = () => {
		if (isSavingPreferences || isUploadingAvatar) {
			return;
		}

		if (hasChanges) {
			setAvatarPreviewFile(null);
			setFormState(
				getProfileFormState({
					user,
					userPreferences,
				}),
			);
		}

		onCancel();
	};

	const handleAvatarUpload = async (file: File) => {
		if (!file.type.startsWith("image/")) {
			toast.error("Please choose an image file");
			return;
		}

		if (file.size > MAX_PROFILE_AVATAR_FILE_SIZE_BYTES) {
			toast.error("Profile avatar must be 5MB or smaller");
			return;
		}

		setIsUploadingAvatar(true);

		try {
			const uploadUrl = await generateAvatarUploadUrl();
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: {
					"Content-Type": file.type || "application/octet-stream",
				},
				body: file,
			});

			if (!response.ok) {
				throw new Error("Failed to upload profile avatar.");
			}

			const result = (await response.json()) as { storageId?: Id<"_storage"> };
			if (!result.storageId) {
				throw new Error("Profile avatar upload did not return a storage id.");
			}
			const avatarStorageId = result.storageId;

			setAvatarPreviewFile(file);
			setFormState((current) => ({
				...current,
				avatarStorageId,
			}));
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to upload profile avatar",
			});
			toast.error(
				getToastErrorMessage(error, "Failed to upload profile avatar"),
			);
		} finally {
			setIsUploadingAvatar(false);
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field>
					<Label className={SETTINGS_LABEL_CLASSNAME}>Avatar</Label>
					<div className="flex items-center gap-4">
						<Avatar className="size-20 rounded-lg">
							<AvatarImage
								src={avatarSrc}
								alt="Profile avatar preview"
								className="object-cover"
							/>
							<AvatarFallback className="rounded-lg bg-muted/40">
								{avatarSrc ? initials : <ImageUp className="size-8" />}
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col gap-2">
							<Button
								variant="outline"
								size="sm"
								className="w-min"
								aria-label="Upload avatar"
								onClick={() => fileInputRef.current?.click()}
								disabled={isSavingPreferences || isUploadingAvatar}
							>
								{isUploadingAvatar ? "Processing..." : "Upload"}
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								aria-label="Upload avatar file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								className="hidden"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (!file) {
										return;
									}

									void handleAvatarUpload(file);
									event.target.value = "";
								}}
							/>
							<FieldDescription>
								Recommend size 1:1, up to 5MB.
							</FieldDescription>
						</div>
					</div>
				</Field>
				<Field>
					<Label htmlFor="settings-name" className={SETTINGS_LABEL_CLASSNAME}>
						Full name
					</Label>
					<Input
						id="settings-name"
						value={formState.name}
						onChange={(event) => {
							const nextName = event.target.value;
							setFormState((current) => ({
								...current,
								name: nextName,
							}));
						}}
						placeholder="Enter your name"
						disabled={isSavingPreferences || isUploadingAvatar}
					/>
				</Field>
				<Field>
					<Label htmlFor="settings-email" className={SETTINGS_LABEL_CLASSNAME}>
						Email
					</Label>
					<Input id="settings-email" value={user.email} disabled />
				</Field>
				<Field>
					<Label
						htmlFor="settings-job-title"
						className={SETTINGS_LABEL_CLASSNAME}
					>
						Job title
					</Label>
					<Input
						id="settings-job-title"
						value={formState.jobTitle}
						onChange={(event) => {
							const nextJobTitle = event.target.value;
							setFormState((current) => ({
								...current,
								jobTitle: nextJobTitle,
							}));
						}}
						placeholder="Enter your job title"
						disabled={isSavingPreferences || isUploadingAvatar}
					/>
				</Field>
				<Field>
					<Label
						htmlFor="settings-company-name"
						className={SETTINGS_LABEL_CLASSNAME}
					>
						Company
					</Label>
					<Input
						id="settings-company-name"
						value={formState.companyName}
						onChange={(event) => {
							const nextCompanyName = event.target.value;
							setFormState((current) => ({
								...current,
								companyName: nextCompanyName,
							}));
						}}
						placeholder="Enter your company name"
						disabled={isSavingPreferences || isUploadingAvatar}
					/>
				</Field>
			</FieldGroup>
			<div className="flex justify-end gap-2 pt-6">
				<Button
					variant="ghost"
					onClick={handleCancel}
					disabled={isSavingPreferences || isUploadingAvatar}
				>
					Cancel
				</Button>
				<Button
					onClick={async () => {
						if (
							!trimmedName ||
							isSavingPreferences ||
							isUploadingAvatar ||
							!hasChanges
						) {
							return;
						}

						setIsSavingPreferences(true);

						try {
							if (hasAuthChanges) {
								const { error } = await authClient.updateUser({
									name: trimmedName,
								});

								if (error) {
									throw new Error(error.message);
								}
							}

							if (hasPreferenceChanges) {
								await updateUserPreferences({
									jobTitle: trimmedJobTitle || null,
									companyName: trimmedCompanyName || null,
									avatarStorageId: formState.avatarStorageId,
								});
							}

							toast.success("Profile updated");
							onSave();
						} catch (error) {
							logError({
								event: "client.error",
								error: error,
								message: "Failed to update profile",
							});
							toast.error(
								getToastErrorMessage(error, "Failed to update profile"),
							);
						} finally {
							setIsSavingPreferences(false);
						}
					}}
					disabled={
						!trimmedName ||
						!hasChanges ||
						isSavingPreferences ||
						isUploadingAvatar
					}
				>
					{isSavingPreferences ? (
						<>
							<LoaderCircle className="animate-spin" />
							Saving
						</>
					) : (
						"Save"
					)}
				</Button>
			</div>
		</div>
	);
}

function ManageAccountForm(props: {
	user: SettingsUser;
	onCancel: () => void;
	onSave: () => void;
}) {
	const formProps = props;
	return useManageAccountFormElement(formProps);
}

function getInitials(name: string, email: string) {
	const source = name.trim() || email;

	return source
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}
