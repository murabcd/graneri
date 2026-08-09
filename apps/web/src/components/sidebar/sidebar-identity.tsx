import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { getAvatarSrc } from "@/lib/avatar";

export function SidebarIdentity({
	avatar,
	name,
}: {
	avatar?: string | null;
	name: string;
}) {
	const initials = name
		.split(/\s+/)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();

	return (
		<>
			<Avatar className="size-5 rounded-md">
				<AvatarImage src={getAvatarSrc({ avatar, name })} alt={name} />
				<AvatarFallback className="rounded-md text-[8px]">
					{initials}
				</AvatarFallback>
			</Avatar>
			<span className="min-w-0 flex-1 truncate font-medium">{name}</span>
		</>
	);
}
