# Design: mbox File Picker

**Date:** 2026-02-28

## Problem

The import screen requires users to type a full file path manually. Users can't see what `.mbox` files are available and have to remember paths.

## Solution

Replace the path text input with a clickable file list that fetches available `.mbox` files from the server.

## Backend

New endpoint: `GET /api/files`

- Scans `/data/` directory for `*.mbox` files using `fs.readdir` + `fs.stat`
- Returns array sorted by name: `[{ name, path, size }]`
- Empty array if no files found
- 500 if `/data/` is unreadable

## Frontend

Replace the path input step in `ImportScreen.jsx`:

- On step load, fetch `/api/files` immediately
- Loading state: spinner
- Loaded: scrollable list of file rows (filename left, human-readable size right)
- Click to select (highlighted), Start Import enabled once a file is chosen
- Empty state: "No .mbox files found in /data/"
- Error state: fall back to showing the original text input
