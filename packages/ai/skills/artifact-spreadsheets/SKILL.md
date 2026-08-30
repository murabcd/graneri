---
name: artifact-spreadsheets
description: Create or edit XLSX workbooks with spreadsheet-specific data, formula, sheet, and chart decisions.
---

# Spreadsheets

Build a usable workbook rather than a prose representation of one:

- Use `spreadsheet_create` for a new XLSX and `spreadsheet_edit` for an uploaded or previously generated XLSX. For edits, copy the source filename, media type, and Graneri storage id exactly and preserve everything outside the requested operations.
- Give each sheet a clear, unique name. Put one header row before tabular data, keep every row aligned with that header, and use numbers and booleans as typed values rather than formatted text when they represent data.
- Express formulas as cell strings beginning with `=` and reference cells rather than embedding calculated results. Do not invent formulas when the user supplied final values only.
- Add a chart only when it improves comprehension. Its category and data column names must exactly match header cells, and the source rows must contain usable numeric data.
- Use `append_rows`, `set_cell`, or `add_sheet` for edits. Do not claim support for deleting sheets, arbitrary range formatting, macros, external connections, CSV, or TSV.

The worker reopens the workbook, rejects formula-error literals, converts it for rendered validation, and publishes only a valid XLSX.
