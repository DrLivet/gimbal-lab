# gimbal-lab: notes for Claude

**Start by reading `HANDOVER.md`.** It has the owner's goals, the current state, what happened on the real hardware, and the next steps.

## Check where you are running first
- **Local session on the owner's Mac** (`uname` says Darwin): the owner's S24 may be on USB. You can use `adb` (install with `brew install android-platform-tools`), so do the phone tasks in HANDOVER.md section B yourself. Don't ask the owner to do them by hand.
- **Cloud session** (Linux): you can't reach the owner's Mac, phone or USB. Build the code and push. For hardware tasks, ask the owner to open a session on their Mac in this folder.
- Verify with a command before telling the owner what you can or can't reach.

## Working rules
- The owner isn't a developer. Keep messages short, plain and action-first.
- Plain JS ES modules with no build step; GitHub Pages serves the repo.
- Run `for t in test/*.test.mjs; do node $t; done` before pushing. `test/page.test.mjs` needs Playwright.
