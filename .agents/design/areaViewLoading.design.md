# Area View Loading State — Known Issue & Attempted Solutions

## Problem

When an area view (Agents, Hooks, Instructions, Plugins, Prompts) is collapsed at startup and the user later expands it, the view briefly shows blank content before the tree data renders. The intended behavior is to show a "Searching for installed {area}..." spinner item while the scan runs, then replace it with results.

The Skills view does not have this problem because it uses a different provider (`InstalledSkillsTreeDataProvider`) with its own loading flow.

---

## Root Cause

The area provider's `getChildren()` returns a spinner tree item when `initialLoading` is `true`. However, by the time VS Code calls `getChildren()` (when the user expands the view), the scan has already completed and `initialLoading` is `false`. The scan completes before the view is ever visible because:

1. The constructor originally kicked off `scanInstalledItems()` immediately.
2. The initial load in `extension.ts` calls `preload()` (or previously `refreshAreaProviders()`) which scans all providers at startup.
3. The scan is fast (just `stat` and `readDirectory` calls on a few paths), so it finishes in milliseconds.

The result: `initialLoading` is already `false` when `getChildren()` first runs, so the spinner never appears.

---

## Current Architecture

The provider uses a mutex-based caching approach:

- `loadItems(force?)` — shared scan method. Uses a mutex (`pendingScan` promise) so concurrent callers share a single scan. Caches results in `installedItems` and sets `cacheReady = true`.
- `preload()` — called at startup. Warms the cache silently. Does NOT set `initialLoading = false`.
- `startInitialScan()` — triggered lazily from `getChildren()` on first expand. Uses `loadItems()` (returns from cache if warm). Sets `initialLoading = false` and fires tree change.
- `refresh(force=true)` — bypasses cache, forces a fresh scan, updates everything.
- `getChildren()` — if `initialLoading` is true and `cacheReady` is true, skips the spinner and renders data directly. If cache is not ready, shows the spinner and calls `startInitialScan()`.

---

## Attempted Solutions

### Attempt 1: Defer scan to `onDidChangeVisibility`

**Approach:** Don't scan in the constructor. Register a `TreeView.onDidChangeVisibility` listener in `setTreeView()`. Start the scan when the view first becomes visible.

**Result:** Failed. The `viewsWelcome` "Loading ..." text appeared but never transitioned to "No agents found." for empty areas. The `initialScanComplete` context key wasn't being set correctly because `refresh()` (called from other code paths) interfered with the deferred scan state.

### Attempt 2: Await `setContext` before firing tree change

**Approach:** Change `vscode.commands.executeCommand('setContext', ...)` from fire-and-forget to `await`ed, ensuring the context key is set before `_onDidChangeTreeData.fire()`.

**Result:** Partially fixed. Empty areas now correctly show "No {area} found." instead of blank. But areas with items still showed blank briefly because the scan had already completed before the view was expanded.

### Attempt 3: Lazy scan from `getChildren()`

**Approach:** Don't scan in the constructor. On first `getChildren()` call, return the spinner item and kick off the scan via `startInitialScan()`. When the scan completes, fire a tree change event.

**Result:** Failed. The initial load in `extension.ts` calls `refreshAreaProviders()` which calls `refresh()` on every provider, completing the scan before the user expands any view. This cleared `initialLoading` before `getChildren()` ever ran.

### Attempt 4: Remove `refreshAreaProviders()` from initial load

**Approach:** Don't call `refreshAreaProviders()` at startup. Let area providers scan lazily when their views are first expanded.

**Result:** The spinner appeared correctly, but marketplace green check icons for area items didn't populate at startup (since no area data was available). This was deemed unacceptable.

### Attempt 5: `preload()` + lazy `startInitialScan()`

**Approach:** Add a `preload()` method that scans and caches items without clearing `initialLoading`. Call `preload()` at startup for green check data. `startInitialScan()` is triggered from `getChildren()` and uses the cached data.

**Result:** Failed. Even though `loadItems()` returned instantly from cache, `startInitialScan()` used `.then()` which defers to the microtask queue. `getChildren()` returned the spinner, but the `.then()` fired so quickly that VS Code never rendered the spinner — it went straight from blank to data.

### Attempt 6: Cache-aware `getChildren()` (current)

**Approach:** In `getChildren()`, if `initialLoading` is true but `cacheReady` is true, skip the spinner entirely and render data directly from cache.

**Result:** Eliminates the blank-then-data flash for most cases, but the spinner still doesn't appear. The view goes from collapsed to showing data, which is acceptable but not ideal.

---

## Potential Future Solutions

1. **VS Code API limitation:** `TreeDataProvider.getChildren()` is synchronous in its return path for the initial render. Even returning a promise doesn't help because VS Code shows nothing until the promise resolves. A proper loading state would require VS Code to support a `loading` property on the tree view itself.

2. **Artificial delay:** Add a small `setTimeout` before resolving the cached data in `startInitialScan()`, giving VS Code time to render the spinner. This is hacky and timing-dependent.

3. **Progress notification:** Instead of a tree item spinner, use `vscode.window.withProgress()` to show a notification-style progress indicator during the scan. This sidesteps the tree rendering issue entirely.

4. **Two-phase render:** Return the spinner from `getChildren()` synchronously, then use `setTimeout(() => { ... fire tree change ... }, 50)` to give VS Code a frame to render the spinner before replacing it with data. Fragile but might work.
