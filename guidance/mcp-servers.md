# Model Context Protocol (MCP) Servers Guide

`ai-dev-workflow` provides two standalone, high-performance MCP servers built with native JSON-RPC 2.0 over `stdio` (zero external dependencies):

1. **`ai-dev-workflow-mcp`**: Exposes task definition creation, sequence execution, mobile verification, and run reports as native agent tools.
2. **`android-emulator-mcp`**: Exposes Android/ADB emulator control, screenshots, UI accessibility tree inspection (`uiautomator dump`), logcat diagnostic reading, and touch/keyboard input.

---

## 1. Quick Start

### Starting the Workflow MCP Server
```bash
npm run mcp:workflow
# or directly:
node --experimental-strip-types src/mcp/workflow-server.ts
```

### Starting the Android Emulator MCP Server
```bash
npm run mcp:android
# or directly:
node --experimental-strip-types src/mcp/android-server.ts
```

---

## 2. Configuration for AI Clients & IDEs

### A. Claude Desktop Configuration
Add the servers to your `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ai-dev-workflow": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/daventor/Projects/ai-dev-workflow/src/mcp/workflow-server.ts"
      ],
      "cwd": "/Users/daventor/Projects/ai-dev-workflow"
    },
    "android-emulator": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/daventor/Projects/ai-dev-workflow/src/mcp/android-server.ts"
      ],
      "cwd": "/Users/daventor/Projects/ai-dev-workflow"
    }
  }
}
```

### B. Antigravity Configuration
Add to your project `.antigravity/mcp_config.json` or global settings:

```json
{
  "mcpServers": {
    "workflow": {
      "command": "npm",
      "args": ["run", "mcp:workflow"],
      "cwd": "/Users/daventor/Projects/ai-dev-workflow"
    },
    "android": {
      "command": "npm",
      "args": ["run", "mcp:android"],
      "cwd": "/Users/daventor/Projects/ai-dev-workflow"
    }
  }
}
```

### C. Cursor Configuration
In **Cursor Settings > Features > MCP**, add a new `command` server:
- **Name:** `ai-dev-workflow`
- **Type:** `command`
- **Command:** `node --experimental-strip-types /Users/daventor/Projects/ai-dev-workflow/src/mcp/workflow-server.ts`

---

## 3. Tool Reference

### `ai-dev-workflow-mcp` Tools

| Tool Name | Description | Key Arguments |
| :--- | :--- | :--- |
| `list_repositories` | Lists all configured repositories, their paths, prefixes, validations, and guidance. | (None) |
| `create_tasks` | Analyzes bug reports & screenshots to create structured Markdown tasks. | `application` (string), `description` (string), `images` (string[]), `singleTask` (boolean), `dryRun` (boolean) |
| `run_tasks` | Executes ordered task queue with isolated commits, validations, and reflection retries. | `application` (string), `tasks` (string[]), `provider` (string), `retries` (number), `rollbackOnFailure` (boolean) |
| `verify_mobile` | Runs declarative mobile verification manifest checks, Android build gates, and Maestro flows. | `application` (string), `dryRun` (boolean), `manifestPath` (string) |
| `get_latest_reports` | Retrieves recent run reports and summary status from `.agent-runs/`. | `limit` (number, default 5) |

---

### `android-emulator-mcp` Tools

| Tool Name | Description | Key Arguments |
| :--- | :--- | :--- |
| `list_devices` | Lists connected Android emulators and physical devices with model/product info. | (None) |
| `take_screenshot` | Captures a PNG screenshot from the device and returns base64 or saves to disk. | `device` (string), `outputPath` (string), `returnBase64` (boolean) |
| `dump_ui_hierarchy` | Dumps accessibility element tree (`uiautomator dump`) with bounds, IDs, and text. | `device` (string), `format` ("summary" \| "xml") |
| `get_logcat` | Fetches filtered logcat diagnostic output from the emulator. | `device` (string), `lines` (number), `level` ("V"\|"D"\|"I"\|"W"\|"E"\|"F"), `filter` (string) |
| `launch_app` | Launches an app package or activity component on the device. | `package` (string), `activity` (string), `device` (string) |
| `send_input` | Sends touch tap, text entry, swipe gesture, or key events (`KEYCODE_BACK`, etc.). | `action` ("tap"\|"text"\|"swipe"\|"keyevent"), `x`, `y`, `text`, `keycode`, `device` |
