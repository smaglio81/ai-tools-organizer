* Do not ask to create a spec session for this. This is not spec driven.

* Check the last commit to main's message. It should start with a version number, that's the prior version number.

* Review the list of changes and create a summary of changes in memory.
  * Determine if the changes are a major, minor or patch change (using Semver rules)
  * Determine an appropriate new version number.
  * Check package.json to see if it is already using the new version number, update it if it isn't.

* Ensure that git is on a branch (not `main`), that matches the new version number.
  * The branch name should start with a `v` (ie. `vX.Y.Z`)
  * Rename the branch if needed.
  * Update the origin with the rename if needed.

* Commit the latest changes with the summary.
* Push the latest commits to origin.
