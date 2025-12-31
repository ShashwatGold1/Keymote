---
description: Commit and push changes to GitHub with user's prompt as commit message
---

# GitHub Auto-Commit Workflow

When the user asks to update/push/commit to GitHub, follow these steps:

## Prerequisites
- Repository: `ShashwatGold1/Keymote`
- Remote: `origin`
- Branch: `master`
- GitHub CLI authenticated as: `ShashwatGold1`

## Steps

// turbo
1. Stage all changes:
```bash
git add .
```

// turbo
2. Commit with user's FULL prompt as the message (GitHub supports up to 72,000 characters):
```bash
git commit -m "<USER'S FULL PROMPT HERE>"
```

// turbo
3. Push to GitHub:
```bash
git push origin master
```

## Notes
- Use the user's EXACT prompt as the commit message - do NOT shorten it
- Always run from: `c:\Users\ojhas\OneDrive\Desktop\MicrophoneS`
- If the prompt contains special characters, escape them properly
