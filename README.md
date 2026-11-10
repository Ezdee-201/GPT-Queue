# ChatGPT Prompt Queue

A Chrome extension that queues your prompts and sends them to ChatGPT one after another, waiting for each reply to finish before starting the next.

Line up a series of prompts, press **Run**, and walk away. The extension types each prompt into ChatGPT, waits for the response to complete, then moves on to the next one. You can edit and reorder the queue, stop at any point, and resume where you left off.

> **Not affiliated with OpenAI.** This is an independent tool that sends prompts you wrote yourself, one at a time, through the ChatGPT web interface.

## Features

- **Prompt queue with a visual timeline.** Each prompt is a step on a rail that fills in as the run progresses. The active prompt shows a live timer.
- **Hands-free runs.** Waits for ChatGPT to finish generating (text, images, anything) before sending the next prompt.
- **Stop and resume.** Stop the queue at any time, then resume from the next unsent prompt or restart from the beginning. If a prompt fails, resume from the one that failed.
- **Edit in place.** Click any prompt to change it.
- **Drag to reorder.** Or use the keyboard (see [Keyboard shortcuts](#keyboard-shortcuts)).
- **Bulk add.** Paste several prompts at once, separated by `---`.
- **Saved queue.** Your queue persists between popup openings and browser restarts.
- **Light and dark mode.** Follows your system setting.
- **Private by design.** Everything stays in your browser. The extension makes no network requests of its own.

## Install

The extension isn't on the Chrome Web Store yet, so install it as an unpacked extension:

1. Download or clone this repository.
   ```bash
   git clone https://github.com/YOUR-USERNAME/chatgpt-prompt-queue.git
   ```
2. Open `chrome://extensions` in Chrome (or any Chromium browser such as Edge, Brave or Arc).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. **Reload any ChatGPT tab that was already open.** Chrome doesn't inject the extension into pages that were open before you installed it.
6. Optional: pin the extension from the puzzle-piece menu so the icon is always visible.

### Updating

Pull the latest changes, then click the refresh icon on the extension's card in `chrome://extensions` and reload your ChatGPT tab.

## Usage

1. Open [ChatGPT](https://chatgpt.com) and start or open a chat. Keep that tab **active and visible**.
2. Click the extension icon to open the popup.
3. Write a prompt in the box at the bottom and press **Enter** to add it to the queue. Repeat for each prompt.
4. Click **Run N prompts**.
5. Watch the timeline. Each prompt is sent only after the previous reply has fully finished.

You can close the popup while the queue runs. Reopen it at any time to check progress.

### Adding several prompts at once

Paste text into the box with `---` on its own line between prompts, then press Enter:

```
Generate an image of a tortoise
---
Write a caption for it
---
Generate an image of a cat
```

Prompts can span multiple lines. Use **Shift+Enter** for a new line inside a prompt.

### Managing the queue

| Action | How |
|---|---|
| Edit a prompt | Click its text. Enter saves, Esc cancels, Shift+Enter adds a line. |
| Reorder | Hover a prompt and drag the handle, or use the keyboard shortcut below. |
| Remove one prompt | Hover it and click the bin icon. |
| Clear everything | **Clear all** above the list (click twice to confirm). |

### Stopping and resuming

- **Stop queue** halts the run. A reply that ChatGPT is already writing will still finish, and that prompt counts as sent.
- After a stop or a failure, the main button becomes **Resume at prompt N**, which continues from where the run ended. **Restart** begins again from prompt 1.
- Editing the queue after a run clears the old progress markers.

### Keyboard shortcuts

| Keys | Where | Action |
|---|---|---|
| Enter | New prompt box | Add to queue |
| Shift+Enter | New prompt box or editor | New line |
| Enter | Focused prompt | Edit it |
| Alt+↑ / Alt+↓ | Focused prompt | Move it up or down |
| Delete | Focused prompt | Remove it |
| Esc | While editing | Cancel the edit |

## How it works

- A **content script** runs on `chatgpt.com` and `chat.openai.com`. It runs the queue inside the page, so closing the popup doesn't interrupt it.
- For each prompt it finds the real message box, takes focus, types the prompt, and clicks send.
- It then watches for ChatGPT's stop-generating button to appear and disappear to know when the reply is done, pauses briefly, and moves on.
- The **popup** is only the control panel. It stores your queue and run progress in `chrome.storage.local` and talks to the content script with messages.

**Permissions**

| Permission | Why it's needed |
|---|---|
| `storage` | Save your queue and run progress locally. |
| `activeTab` | Talk to the ChatGPT tab you're currently on. |
| Content script on `chatgpt.com` and `chat.openai.com` | Type prompts and detect when a reply has finished. |

## Known limitations

- **It depends on ChatGPT's page layout.** The extension finds ChatGPT's input box, send button and stop button with CSS selectors. If OpenAI changes its interface, the extension may stop working until the selectors are updated (see [Troubleshooting](#troubleshooting)).
- **Keep the ChatGPT tab visible.** Run the queue from the active tab, and leave it in view (a separate window works well). Chrome can throttle hidden background tabs, which can slow or stall a run.
- **All prompts go into one conversation.** Each prompt sees the earlier replies as context. The extension doesn't start a new chat per prompt.
- **One queue at a time.** You can run a single queue in a single tab. The queue and composer are locked while a run is in progress.
- **Stop doesn't cancel an in-progress reply.** It only prevents further prompts from being sent.
- **Text prompts only.** No file attachments, model switching or other ChatGPT settings.
- **Long replies are capped.** The extension waits up to about 10 minutes for a single reply to finish before reporting a failure.
- **No sync across devices.** The queue is stored locally in your browser profile.
- **Possible conflicts with ChatGPT features.** Pop-ups, rate-limit messages, login prompts, or other interruptions in the page can cause a prompt to fail. Resume once the page is back to normal.
- **Use within OpenAI's terms.** Automating a web interface may be restricted by the service's terms. Review OpenAI's current usage terms and use the tool responsibly, for prompts you wrote yourself and at a reasonable pace.

## Troubleshooting

| Problem | What to try |
|---|---|
| "Reload your ChatGPT tab once to finish setup" | Reload the ChatGPT tab. The extension isn't injected into tabs opened before installation. |
| "Open a ChatGPT tab and switch to it" | The popup acts on the active tab. Switch to a ChatGPT tab, then reopen the popup. |
| "Could not find the ChatGPT input box" | Make sure a chat is open and the message box is visible on screen. |
| "Could not type into the ChatGPT input box" | Click once in the message box and press **Resume**. |
| Text goes into the wrong field | Open DevTools, inspect the field, and open an issue with its tag and attributes. |
| The run seems stuck | Check the ChatGPT tab for errors or pop-ups, press **Stop**, fix the issue, then **Resume**. |

For deeper debugging, open DevTools on the ChatGPT tab (F12) and look for console lines starting with `[PromptQueue]`.

### Updating selectors after a ChatGPT redesign

All page selectors live at the top of `content.js`:

```js
const INPUT_SELECTORS = [ /* the prompt box */ ];
const SEND_SELECTORS  = [ /* the send button */ ];
const STOP_SELECTORS  = [ /* the stop-generating button */ ];
```

Inspect the element in ChatGPT, add a selector that matches it, reload the extension and the tab, and test.

## Project structure

```
.
├── manifest.json   # Manifest V3 configuration
├── content.js      # Runs the queue inside the ChatGPT page
├── popup.html      # Popup markup
├── popup.css       # Popup styles (light and dark)
├── popup.js        # Queue management and UI
└── icons/          # Toolbar and store icons
```

There is no build step. Edit the files, refresh the extension in `chrome://extensions`, and reload the ChatGPT tab.

## Privacy

- Your prompts and run progress are stored only in your browser using `chrome.storage.local`.
- The extension collects no analytics and sends no data to any server.
- It only runs on `chatgpt.com` and `chat.openai.com`.

## Contributing

Issues and pull requests are welcome. If something breaks after a ChatGPT update, an issue that includes the failing element's tag and attributes (from DevTools) is the most useful thing you can send.

## License

Released under the [MIT License](LICENSE).
