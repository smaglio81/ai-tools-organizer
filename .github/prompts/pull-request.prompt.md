---
name: pull-request
description: Create a github pull request for this project
metadata:
  version: "2026.04.01"
---

# AI Tools Organizer Pull Request

## Instructions

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

* Create a Pull Request between the version branch and `main`.
  * Use CHANGELOG.md to create a Pull Request summary.

* Once the Pull Request is created, the Copilot Reviewer should automatically review the PR.
  * Can you use the review-with-copilot skill to wait for the Copilot review to complete and the follow the skills instructions.

## Output

The output should include a link to the PR

## Notes

If a .env file exists and it contains a gh_token inside of it, then you should load the .env file in order to authenticate when running `gh` commands that require authentication:

1. Load the `.env` file to set environment variables silently — do NOT embed the token value directly in commands.
2. Use this pattern in PowerShell:
   ```powershell
   Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }; gh ...
   ```
3. Never print, echo, or reference the token value directly in any command string.