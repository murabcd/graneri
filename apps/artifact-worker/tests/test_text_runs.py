from __future__ import annotations

import unittest
from dataclasses import dataclass

from src.text_runs import replace_text_in_runs


@dataclass
class StyledRun:
    text: str
    style: str


class TextRunEditingTest(unittest.TestCase):
    def test_replaces_cross_run_text_without_collapsing_run_styles(self) -> None:
        runs = [
            StyledRun("Quarterly re", "bold"),
            StyledRun("port is ", "italic"),
            StyledRun("ready.", "plain"),
        ]

        replacements = replace_text_in_runs(runs, "report is", "briefing was", False)

        self.assertEqual(replacements, 1)
        self.assertEqual(
            "".join(run.text for run in runs), "Quarterly briefing was ready."
        )
        self.assertEqual([run.style for run in runs], ["bold", "italic", "plain"])

    def test_replaces_every_non_overlapping_match_from_the_end(self) -> None:
        runs = [StyledRun("one one", "plain"), StyledRun(" one", "bold")]

        replacements = replace_text_in_runs(runs, "one", "two words", True)

        self.assertEqual(replacements, 3)
        self.assertEqual(
            "".join(run.text for run in runs), "two words two words two words"
        )


if __name__ == "__main__":
    unittest.main()
