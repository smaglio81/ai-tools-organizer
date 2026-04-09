---
name: review-with-copilot
description: A loop for continuously reviewing the Copilot comments on a pull request until all comments are resolved by implmenetation or explanation.
metadata:
  version: "2026.04.08"
---

# Review with Copilot

## Goals

* Review the comments made by Copilot in the pull request.
* Determine to either implement the suggested changes or not.
  * Either way, leave a comment and resolve the comment.
* If you implemented any changes
  * Commit the changes with a comment and push the changes
  * Ask for Copilot to review the changes
* Monitor for Copilot to finish it's review.
* Repeat until you determine no further changes should be made.

## How to Request a Copilot Review

Copilot reviews can be triggered via the GitHub API by adding `copilot-pull-request-reviewer[bot]` as a requested reviewer:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/requested_reviewers \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

This works even if Copilot has already reviewed the PR — it will re-review against the latest commit.

## How to Read Copilot Review Comments

Copilot's comments are stored as PR review comments (not regular issue comments). Fetch them with:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
```

Each comment includes `body` (the suggestion), `path` (the file), `line`/`start_line` (the code range), and `id` (for replying).

## How to Reply to a Copilot Comment

Use the issue comments endpoint to post a general reply on the PR:

```bash
gh pr comment {pr_number} --body "Your response here"
```
