# LabelPlusX

Modern, multi-platform LabelPlus client.

## Targets

- Tauri desktop app for macOS, Linux, Windows
- Web self-hosted build

## Development

```bash
npm ci
npm run build
npm run lint
cd src-tauri && cargo check
```

## Features

- Compatible with legacy LabelPlus txt workspaces
- Image preview, zoom, pan, marker editing
- Check mode with vertical and horizontal reading layouts
- QuickText, groups, autosave, desktop save-back
- Create new workspace from images or desktop project folder
