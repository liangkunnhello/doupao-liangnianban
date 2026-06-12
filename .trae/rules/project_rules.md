# Project Rules

## Project Overview
- **Name**: GPT Image Playground (豆泡)
- **Type**: Electron + React + Vite desktop application
- **GitHub Repo**: https://github.com/nideyilian/doupao
- **Current Version**: see `package.json` version field

## Build & Quality Commands
- `npx tsc --noEmit` — type check
- `npx vitest run` — run all tests
- `npm run build` — build frontend (vite)
- `npm run electron:build` — build electron app (local, no publish)
- `npm run release:dry` — build electron app without publishing to GitHub
- `npm run release` — build electron app AND publish to GitHub Releases

## Version Release & Publish Flow

When the user says "发布版本" / "发布" / "推送更新" / "release" or asks to update version and push, follow this flow strictly:

### Step 1: Bump Version
1. Read current version from `package.json`
2. Ask user what version to bump to (or infer: patch/minor/major)
3. Update `version` field in `package.json`

### Step 2: Verify Code Quality
1. Run `npx tsc --noEmit`
2. Run `npx vitest run`
3. If either fails, stop and fix issues before proceeding

### Step 3: Commit & Tag
```bash
git add package.json package-lock.json
git commit -m "release: v<VERSION>"
git tag v<VERSION>
```

### Step 4: Push to GitHub
```bash
git push origin main
git push origin v<VERSION> --tags
```
Note: User's network may require Watt Toolkit GitHub acceleration to be enabled. If push fails due to network, remind user to enable acceleration tool.

### Step 5: Verify Release
1. Check GitHub Actions workflow status:
   ```
   curl -s -H "Authorization: token <GH_TOKEN>" https://api.github.com/repos/nideyilian/doupao/actions/runs?per_page=1
   ```
2. Wait for workflow to complete (usually 5-10 minutes)
3. Confirm Release appears at: https://github.com/nideyilian/doupao/releases

### Auto-Update Mechanism
- electron-updater checks GitHub Releases for new versions
- When user opens app, it auto-checks on startup (production mode only)
- Settings modal "关于" tab shows update status and manual check button
- When update available: prompts download → install on quit

## Code Style
- DO NOT add comments unless asked
- Follow existing patterns in codebase
- Match surrounding code conventions
