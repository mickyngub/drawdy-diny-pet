# Developing Diny Pet

```bash
npm install
npm test
npm run typecheck
npm run dev          # dev server on :5197; in Drawdy run ⌘K → "Add extension dev server" on a local board
npm run build        # builds dist/main.js and dist/*.drawdyx
uv run art/slice.py  # regenerates src/sprite-data.ts from the frames in art/
npm run preflight    # before submitting: committed, built, pushed, under Drawdy's limits, above the live version
```

Drawdy builds published versions from this repository's `src/index.ts`, so commit `src/sprite-data.ts` after `uv run art/slice.py`. Bump `driverVersion` in `manifest.json` for every release and add it to `CHANGELOG.md`. `npm test` holds the manifest and listing files to Drawdy's submission rules (a description of at most 500 characters, an icon of at most 256 KB, only `@drawdy/driver-protocol` imported from outside the repository).
