# LabelPlusX

LabelPlusX is a modern multi-platform LabelPlus client for manga, comic, and image-based translation workflows.

It keeps compatibility with the legacy LabelPlus `txt` workspace format, while replacing the original mode-heavy desktop workflow with a more direct editor that works on both desktop and web.

## Targets

- Tauri desktop app for macOS, Linux, and Windows
- Web build for self-hosting
- GitHub Pages deployment for the web version
- Docker image for self-hosted web deployment

## What It Does

- Open existing legacy LabelPlus `txt` workspaces
- Create new workspaces from images
- Preview images with zoom, pan, and marker editing
- Add, move, and delete labels directly on the image
- Edit translation text with QuickText shortcuts
- Manage groups, comments, and check-mode reading layouts
- Save back to the original desktop `txt` file or browser local storage

## Main Features

### Workspace

- Compatible with the original LabelPlus text format
- Create a new workspace from selected images in Web mode
- Create a new workspace from a project folder in Tauri mode
- Auto-generate a new `translation.txt` style workspace file for desktop projects
- Keep group definitions and comments inside the workspace

### Image Preview

- Mouse wheel zoom
- Drag to pan
- Double click blank area to create a label
- Right click a label to delete it
- Drag labels to update marker positions
- Single click selects a label
- Double click centers the preview on the label

### Translation Editing

- Single-line translation list for faster scanning
- Current label editor with category switching
- Quick jump to untranslated entries
- Undo / redo support
- Keyboard-driven workflow for switching files, labels, and views

### QuickText

- Insert preset short phrases into the current text box
- Open QuickText from the preview and create a label directly at the pointer position
- Customizable phrases and keys in settings
- Works with `Option + A` on macOS and `Alt + A` on other platforms

### Check Mode

- Toggle between normal editing and check view
- Horizontal and vertical reading layouts
- Adjustable check-mode font size
- Text overlay directly on the preview image

### Save Behavior

- Web: save edits to browser local storage
- Tauri: save edits back to the original workspace `txt` file
- Optional auto-save

## Platforms

### Web

- Import an existing LabelPlus `txt` file
- Link local images by filename
- Create a new workspace by selecting images directly
- Persist edits in browser local storage

### Tauri Desktop

- Open an existing local LabelPlus workspace
- Create a new project by selecting a folder of images
- Save directly back to the source `txt` file
- Package builds for macOS, Linux, and Windows

## Keyboard Shortcuts

Current shortcut behavior is documented in the in-app settings panel. The most important ones include:

- `1 - 9`: switch current group
- `Delete / Backspace`: delete selected label
- `Cmd/Ctrl + S`: save
- `Cmd/Ctrl + Z`, `Cmd/Ctrl + Y`: undo / redo
- `Left / Right`: previous / next image
- `Cmd/Ctrl + Enter`: move to the next label while editing
- `V`: hold to temporarily hide labels
- `R`: fit image
- `C`: toggle check mode
- `W`: switch reading layout
- `Enter`: focus current label text editor
- `Option/Alt + A`: open QuickText

## Tech Stack

- React 19
- TypeScript
- Vite
- Tauri 2
- Rust

## Project Structure

- `src/`: React frontend
- `src/lib/labelplus.ts`: legacy LabelPlus text parsing and serialization
- `src/lib/tauri.ts`: desktop bridge helpers
- `src-tauri/`: Tauri + Rust backend
- `.github/workflows/`: CI, desktop builds, Docker, Pages deployment
- `Dockerfile`: self-hosted web image build

## Development

Install dependencies:

```bash
npm ci
```

Run the web dev server:

```bash
npm run dev
```

Run the Tauri desktop app in development:

```bash
npm run tauri dev
```

Lint and build:

```bash
npm run lint
npm run build
cd src-tauri && cargo check
```

## Production Build

Build the web app:

```bash
npm run build
```

Build the desktop app bundles:

```bash
npm run tauri build
```

## Deployment

### GitHub Actions

This repository includes workflows for:

- Desktop bundle builds across major platforms
- Docker image build and publish
- GitHub Pages deployment for the web app

### GitHub Pages

The web app can be deployed to GitHub Pages through `.github/workflows/pages.yml`.

### Docker

Build locally:

```bash
docker build -t labelplusx-web .
```

Run locally:

```bash
docker run --rm -p 8080:80 labelplusx-web
```

Then open `http://localhost:8080`.

## First Run Guide

### Web: Start From Images

1. Open the web app.
2. Click `新建工作区`.
3. Select the images you want to include.
4. A new empty workspace will be created automatically.
5. Double click on the image to create labels.
6. Fill translation text in the right panel.
7. Your edits are saved to browser local storage.

### Web: Open Existing LabelPlus Text

1. Click `导入工作区`.
2. Select an existing LabelPlus `txt` file.
3. If needed, use `关联本地图片` to attach matching local images.
4. Continue editing labels, groups, and translation text.

### Tauri: Start a New Desktop Project

1. Launch the desktop app.
2. Click `新建工作区`.
3. Select a project folder that contains your source images.
4. LabelPlusX scans the folder and creates a new workspace text file automatically.
5. The generated workspace is opened immediately.
6. Edit labels and save back to the original `txt` file.

### Tauri: Open Existing Desktop Project

1. Click `导入工作区`.
2. Choose an existing LabelPlus `txt` workspace.
3. LabelPlusX loads the workspace and matching local images from the same folder.
4. Edit and save directly back to the source file.

## Typical Workflow

### 1. Create Or Open A Workspace

- Web: create from images or open an existing `txt`
- Tauri: create from a project folder or open an existing `txt`

### 2. Review The Image List

- Use the left panel to switch between files
- The active file is kept in sync with keyboard navigation
- Thumbnails help verify image matching

### 3. Add Labels

- Double click a blank spot on the image to create a label
- Use the current selected group for the new label
- Drag labels to refine their positions

### 4. Fill Translation Text

- Select a label from the preview or the right-side list
- Type in the current label editor
- Use QuickText for repeated short phrases
- Press `Cmd/Ctrl + Enter` to move to the next label while staying in text flow

### 5. Use Groups

- Switch the active group from the left-side group chips
- Rename groups when needed
- Only empty groups can be removed

### 6. Review In Check Mode

- Toggle check mode from the preview toolbar
- Switch between horizontal and vertical reading layouts
- Adjust check-mode font size from settings

### 7. Save

- Web: edits are stored in browser local storage
- Tauri: save writes back to the original workspace file
- Use `Cmd/Ctrl + S` for manual save

## Current Status

LabelPlusX already covers the main day-to-day workflow:

- create or import workspace
- initialize images
- edit labels and translations
- use QuickText
- run check mode
- save and export legacy text

There are still possible future improvements, but the core workflow is already usable.

## License

See `LICENSE`.
