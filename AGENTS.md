# Study Planner release history

Write user-facing release notes in English. While developing features or fixing noticeable bugs, add concise entries to `unreleasedChanges` in `dist/releases.js`. Group related work into one note. Tiny visual adjustments such as spacing or icon alignment can be omitted.

When preparing a release, move those notes into one `releaseHistory` entry and clear the pending list. Choose the highest applicable level for the whole release.

- **Major** changes the overall way people use the planner, such as introducing a shared, collaborative workspace. Increment the major number and reset the minor and patch numbers.
- **Minor** adds a feature within the existing workflow, such as calendar import. Increment the minor number and reset the patch number.
- **Patch** ships fixes or refinements to existing behavior. Increment the patch number.

Keep existing release numbers stable. Display versions as `v2.14` when the patch is zero, or `v2.13.1` for a patch release.

Before each commit, run `node scripts/update-readme.mjs` from the project root and include the synchronized README. The in-app history and README use the same source in `dist/releases.js`.

When publishing to `gh-pages`, run `node scripts/prepare-pages.mjs` after updating the README. Commit the contents of the printed directory to the root of `gh-pages`. The script disables link previews and fingerprints the assets in `index.html` so the public address stays the same across releases.
