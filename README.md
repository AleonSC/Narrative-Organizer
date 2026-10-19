# Narrative Organizer

A Windows desktop app for building a story one idea at a time. Type each idea into a text box and it gets an index number. You can then arrange the ideas on a timeline that branches, and read the finished result as one continuous piece of prose.

## Features

| View | What it's for |
| --- | --- |
| **List** (Ctrl+1) | Type an idea and press **Ctrl+Enter** to index it (#1, #2, #3…). You can search, filter, tag, and drag ideas into any order. |
| **Timeline** (Ctrl+2) | Drag ideas from the *Unplaced* pool onto the **Main Timeline**. Hover over any card and click **⑂ Branch** to fork the story at that point. Each branch gets its own lane, and branches can have branches of their own. Drag cards to reorder them or to move them between lanes. Drop a card back on the pool to take it off the timeline. |
| **Board** (Ctrl+3) | A free-form corkboard where you can drag notes anywhere to cluster and organize them. Double-click empty space to add an idea. |
| **Read** (Ctrl+4) | Shows any path (Main, or *Main → Branch → Sub-branch*) as one continuous story, like a WordPad document. You can edit the text in place. You can also choose how ideas are joined: a new paragraph, a scene break (* * *), or run together. Copy the story, export it to `.rtf` (opens in WordPad), `.txt` or `.md`, or print or save it as a PDF. |

Other features:
- Clicking any idea opens the editor, where you can change its title, text, tags, color and position on the timeline.
- **Undo/redo** (Ctrl+Z / Ctrl+Y) covers every change, including drags and deletions.
- Saving is automatic. Your project is a single `.narrative` file, stored by default in `Documents\Narrative Organizer\My Narrative.narrative`. Use the **⋯** menu or the **File** menu for New, Open, Save As and Export.
- Dark mode is in the ⋯ menu.

### How branches read

A branch starts *after* a specific idea. If you read a branch, you get the parent's ideas up to and including the fork point, followed by the branch's own ideas. If you move the card a branch forks from, the branch moves with it.

## Using it on your phone

The same app runs as a website that you can install to your home screen. It works offline and opens full-screen like a normal app.

**Link:** https://aleonsc.github.io/Narrative-Organizer/

- **iPhone (Safari):** open the link, tap **Share → Add to Home Screen**.
- **Android (Chrome):** open the link, tap **⋮ → Install app** (or *Add to Home screen*).

On touch screens, **press and hold** a card for a moment to pick it up and drag it. A quick swipe scrolls as usual, and a tap opens the idea.

**Your phone keeps its own copy of your ideas**, stored on the phone. It does not sync with the Windows app. To move a project between devices:
- **Phone → PC:** ⋯ menu → *Download a copy (.narrative)*, send the file to your PC, then open it in the Windows app with File → Open.
- **PC → phone:** in the Windows app use File → Save As, put the `.narrative` file somewhere your phone can reach (OneDrive, Google Drive, email…), then on the phone use ⋯ → *Import a .narrative file*.

Install it to the home screen instead of just bookmarking it. Browsers can clear storage for websites you haven't visited in a while, but installed apps are kept.

*One-time setup (repo owner):* in the GitHub repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. After that, every push redeploys the site automatically.

## Getting the .exe

### Option A: download a build from GitHub
Every push to this repo runs the **Build Windows app** workflow (under the *Actions* tab). Open the latest run and download the **Narrative-Organizer-Windows** artifact. It contains:
- `Narrative Organizer Setup 1.0.0.exe`: an installer that adds Start-menu and desktop shortcuts.
- `Narrative Organizer 1.0.0.exe`: a portable version that runs without installing.

Windows SmartScreen may warn you because the app is unsigned. Click **More info → Run anyway**.

### Option B: build it yourself on Windows
1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder, run:
   ```
   npm install
   npm start          # run the app directly
   npm run dist       # build the installer + portable .exe into dist\
   ```
