import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type NoteListItem = FunctionReturnType<
	typeof api.notes.list
>["page"][number];
export type NoteRecord = NonNullable<FunctionReturnType<typeof api.notes.get>>;
export type SharedNoteRecord = NonNullable<
	FunctionReturnType<typeof api.notes.getShared>
>;
