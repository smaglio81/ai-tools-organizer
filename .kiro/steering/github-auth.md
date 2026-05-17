---
inclusion: auto
---

# GitHub CLI Authentication

When running `gh` commands that require authentication:

1. Load the `.env` file to set environment variables silently — do NOT embed the token value directly in commands.
2. Use this pattern in PowerShell:
   ```powershell
   Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }; gh ...
   ```
3. Never print, echo, or reference the token value directly in any command string.
