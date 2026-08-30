from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class TextRun(Protocol):
    text: str


def replace_text_in_runs(
    runs: Sequence[TextRun],
    find: str,
    replace: str,
    replace_all: bool,
) -> int:
    full_text = "".join(run.text for run in runs)
    match_starts: list[int] = []
    search_from = 0
    while (match_start := full_text.find(find, search_from)) >= 0:
        match_starts.append(match_start)
        if not replace_all:
            break
        search_from = match_start + len(find)

    for match_start in reversed(match_starts):
        match_end = match_start + len(find)
        offset = 0
        start_index = -1
        end_index = -1
        start_offset = 0
        end_offset = 0
        for index, run in enumerate(runs):
            next_offset = offset + len(run.text)
            if start_index < 0 and match_start < next_offset:
                start_index = index
                start_offset = match_start - offset
            if match_end <= next_offset:
                end_index = index
                end_offset = match_end - offset
                break
            offset = next_offset
        if start_index < 0 or end_index < 0:
            raise RuntimeError(
                "Matched text could not be mapped back to document runs."
            )

        start_run = runs[start_index]
        end_run = runs[end_index]
        prefix = start_run.text[:start_offset]
        suffix = end_run.text[end_offset:]
        start_run.text = (
            f"{prefix}{replace}{suffix if start_index == end_index else ''}"
        )
        if start_index != end_index:
            for index in range(start_index + 1, end_index):
                runs[index].text = ""
            end_run.text = suffix

    return len(match_starts)
