# ChatGPT History Search

Chrome extension to search, archive, and delete your ChatGPT conversations.

## Features

- **Search** — filter conversations by title with live match count
- **Cleanup Mode** — select conversations to archive or delete
  - Archive moves conversations to ChatGPT's archive (recoverable)
  - Delete hides conversations from ChatGPT (soft-delete)
- **Batch selection** — shift-click for range select, drag to paint selections
- **Live loading** — real-time counter and timer while fetching conversations

## Install

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

## Usage

1. Navigate to [chatgpt.com](https://chatgpt.com)
2. Open the extension and click **Connect to ChatGPT**
3. Click **Load Conversations** to fetch your history
4. Use the search bar to filter, or enter **Cleanup Mode** to archive/delete

## Privacy & Security

This extension communicates exclusively with `chatgpt.com`. Your session token is stored locally in Chrome's extension storage and is never transmitted to the extension author or any third-party server. No analytics, telemetry, or external network requests are made. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE)
