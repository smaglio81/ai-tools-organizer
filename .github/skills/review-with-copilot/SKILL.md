---
name: review-with-copilot
description: A loop for continuously reviewing the Copilot comments on a pull request until all comments are resolved by implementation or explanation.
metadata:
  version: "2026.04.09"
---

# Review with Copilot

## Workflow

1. Determine the PR number from the current branch (use `gh pr list --head {branch} --state open`).
2. If there is a `.env` file with a GH_TOKEN:
   a. Load the `.env` file to set `GH_TOKEN` before every `gh` command.
3. Fetch all review threads using GraphQL (see below). Filter to only **unresolved** threads.
4. For each unresolved thread:
   a. Read the comment body, file path, and line range.
   b. Decide whether to implement the suggestion or decline it.
   c. If implementing: make the code change.
   d. If declining: note the reason.
   e. Resolve the thread using the GraphQL mutation (see below).
5. If any code changes were made:
   a. Commit and push.
   b. Post a PR comment summarizing what was fixed and what was declined.
   c. Request a new Copilot review (see below).
   d. **Poll for the review to complete** (see Polling section below).
   e. Go back to step 3.
6. If no unresolved threads remain (or only declined items), the loop is done.

## Polling for Copilot Review Completion

After requesting a review, Copilot typically takes 1-3 minutes. Poll using this approach:

1. Record the current review count: `gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews --jq 'length'`
2. Wait 60 seconds (`Start-Sleep -Seconds 60`).
3. Check the review count again. If it increased, the new review is in.
4. If not, wait another 60 seconds and retry. Give up after 5 attempts (5 minutes) and tell the user.

## How to Request a Copilot Review

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/requested_reviewers \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

## How to Read Unresolved Threads (GraphQL)

The REST API does not expose the resolved state. Use GraphQL:

```bash
gh api graphql -f query='{ repository(owner: "{owner}", name: "{repo}") {
  pullRequest(number: {pr_number}) {
    reviewThreads(first: 50) {
      nodes { id isResolved comments(first: 1) { nodes { databaseId body path: resourcePath } } }
    }
  }
} }'
```

Filter results to `isResolved == false`. Each thread has:
- `id` — node ID (needed for resolving)
- `comments.nodes[0].databaseId` — maps to the REST comment ID
- `comments.nodes[0].body` — the suggestion text

To get the file path and line numbers for a comment, use the REST API with the `databaseId`:
```bash
gh api repos/{owner}/{repo}/pulls/comments/{databaseId}
```

## How to Resolve a Thread

```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_node_id}"}) { thread { isResolved } } }'
```

## How to Post a PR Comment

```bash
gh pr comment {pr_number} --body "Your response here"
```
