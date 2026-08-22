import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { McpServer, type McpTool } from './protocol.ts';

const execFileAsync = promisify(execFile);

async function runAdb(args: string[], binary: string = 'adb'): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(binary, args, { maxBuffer: 10 * 1024 * 1024 });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (err: unknown) {
    const error = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stderr = error.stderr ? error.stderr.toString() : '';
    const stdout = error.stdout ? error.stdout.toString() : '';
    throw new Error(`ADB command failed: ${args.join(' ')}\nStderr: ${stderr}\nStdout: ${stdout}\nMessage: ${error.message || ''}`);
  }
}

async function runAdbBuffer(args: string[], binary: string = 'adb'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ADB command failed: ${args.join(' ')}\nStderr: ${stderr.toString()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export interface AndroidDevice {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
}

export function parseAdbDevices(output: string): AndroidDevice[] {
  const lines = output.trim().split('\n');
  const devices: AndroidDevice[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const serial = parts[0];
      const state = parts[1];
      const details = line.substring(line.indexOf(state) + state.length).trim();

      const modelMatch = details.match(/model:(\S+)/);
      const productMatch = details.match(/product:(\S+)/);
      const deviceMatch = details.match(/device:(\S+)/);

      devices.push({
        serial,
        state,
        model: modelMatch ? modelMatch[1] : undefined,
        product: productMatch ? productMatch[1] : undefined,
        device: deviceMatch ? deviceMatch[1] : undefined,
      });
    }
  }
  return devices;
}

export function parseHierarchySummary(xml: string): Array<Record<string, string>> {
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  const elements: Array<Record<string, string>> = [];
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrString = match[1];
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;

    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    const text = attrs['text'] || '';
    const contentDesc = attrs['content-desc'] || '';
    const resourceId = attrs['resource-id'] || '';
    const className = attrs['class'] || '';
    const bounds = attrs['bounds'] || '';
    const clickable = attrs['clickable'] === 'true';

    if (text || contentDesc || resourceId || clickable) {
      elements.push({
        class: className.replace(/^android\.widget\./, ''),
        resourceId: resourceId.replace(/^[^:]+:id\//, ''),
        text: text ? text.substring(0, 100) : '',
        contentDesc: contentDesc ? contentDesc.substring(0, 100) : '',
        bounds,
        clickable: String(clickable),
      });
    }
  }

  return elements;
}

export function createAndroidTools(adbBinary: string = 'adb'): McpTool[] {
  function targetArgs(device?: string): string[] {
    return device ? ['-s', device] : [];
  }

  const listDevicesTool: McpTool = {
    name: 'list_devices',
    description: 'List all connected Android emulators and physical devices.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const { stdout } = await runAdb(['devices', '-l'], adbBinary);
      const devices = parseAdbDevices(stdout);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ devices, count: devices.length }, null, 2),
          },
        ],
      };
    },
  };

  const takeScreenshotTool: McpTool = {
    name: 'take_screenshot',
    description: 'Capture a PNG screenshot from the Android emulator or device.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Optional serial/emulator identifier' },
        outputPath: { type: 'string', description: 'Local file path to save the PNG screenshot' },
        returnBase64: { type: 'boolean', description: 'Return base64-encoded image data in response' },
      },
    },
    handler: async (args) => {
      const device = args.device ? String(args.device) : undefined;
      const outputPath = args.outputPath ? String(args.outputPath) : undefined;
      const returnBase64 = Boolean(args.returnBase64) || !outputPath;

      const buffer = await runAdbBuffer([...targetArgs(device), 'exec-out', 'screencap', '-p'], adbBinary);

      if (outputPath) {
        await writeFile(outputPath, buffer);
      }

      const responseContent: Array<{ type: 'text'; text: string }> = [];
      if (outputPath) {
        responseContent.push({ type: 'text', text: `Screenshot saved to ${outputPath} (${buffer.length} bytes)` });
      }
      if (returnBase64) {
        responseContent.push({ type: 'text', text: `data:image/png;base64,${buffer.toString('base64')}` });
      }

      return { content: responseContent };
    },
  };

  const dumpUiHierarchyTool: McpTool = {
    name: 'dump_ui_hierarchy',
    description: 'Dump and inspect the current Android UI view tree and accessibility elements.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Optional serial/emulator identifier' },
        format: {
          type: 'string',
          enum: ['summary', 'xml'],
          description: 'Format to return: "summary" (token-efficient element list) or "xml" (raw XML hierarchy)',
        },
      },
    },
    handler: async (args) => {
      const device = args.device ? String(args.device) : undefined;
      const format = args.format === 'xml' ? 'xml' : 'summary';

      await runAdb([...targetArgs(device), 'shell', 'uiautomator', 'dump', '/data/local/tmp/uidump.xml'], adbBinary);
      const { stdout: xml } = await runAdb([...targetArgs(device), 'exec-out', 'cat', '/data/local/tmp/uidump.xml'], adbBinary);

      if (format === 'xml') {
        return {
          content: [{ type: 'text', text: xml }],
        };
      }

      const elements = parseHierarchySummary(xml);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ elementCount: elements.length, elements }, null, 2),
          },
        ],
      };
    },
  };

  const getLogcatTool: McpTool = {
    name: 'get_logcat',
    description: 'Retrieve recent logcat diagnostic output from the Android emulator.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Optional serial/emulator identifier' },
        lines: { type: 'number', description: 'Number of recent log lines to fetch (default: 50)' },
        level: {
          type: 'string',
          enum: ['V', 'D', 'I', 'W', 'E', 'F'],
          description: 'Minimum log priority filter (Verbose, Debug, Info, Warning, Error, Fatal)',
        },
        filter: { type: 'string', description: 'Tag or substring filter' },
      },
    },
    handler: async (args) => {
      const device = args.device ? String(args.device) : undefined;
      const lines = typeof args.lines === 'number' ? args.lines : 50;
      const level = args.level ? String(args.level) : 'I';
      const filter = args.filter ? String(args.filter) : '';

      const cmdArgs = [...targetArgs(device), 'logcat', '-d', '-t', String(lines), `*:${level}`];
      const { stdout } = await runAdb(cmdArgs, adbBinary);

      let output = stdout;
      if (filter) {
        output = output
          .split('\n')
          .filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
          .join('\n');
      }

      return {
        content: [{ type: 'text', text: output || '(No matching logcat entries)' }],
      };
    },
  };

  const launchAppTool: McpTool = {
    name: 'launch_app',
    description: 'Launch an application package or activity on the Android device/emulator.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Optional serial/emulator identifier' },
        package: { type: 'string', description: 'Android application package name (e.g. "com.myapp.dev")' },
        activity: { type: 'string', description: 'Optional main activity (e.g. ".MainActivity")' },
      },
      required: ['package'],
    },
    handler: async (args) => {
      const device = args.device ? String(args.device) : undefined;
      const pkg = String(args.package);
      const activity = args.activity ? String(args.activity) : undefined;

      let resultText = '';
      if (activity) {
        const component = activity.startsWith('.') ? `${pkg}/${activity}` : activity.includes('/') ? activity : `${pkg}/${activity}`;
        const { stdout } = await runAdb([...targetArgs(device), 'shell', 'am', 'start', '-n', component], adbBinary);
        resultText = stdout.trim();
      } else {
        const { stdout } = await runAdb([...targetArgs(device), 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], adbBinary);
        resultText = stdout.trim();
      }

      return {
        content: [{ type: 'text', text: resultText || `Launched ${pkg}` }],
      };
    },
  };

  const sendInputTool: McpTool = {
    name: 'send_input',
    description: 'Send touch tap, text input, swipe gesture, or key event to the Android device.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Optional serial/emulator identifier' },
        action: {
          type: 'string',
          enum: ['tap', 'text', 'swipe', 'keyevent'],
          description: 'Input action type',
        },
        x: { type: 'number', description: 'X coordinate for tap or swipe start' },
        y: { type: 'number', description: 'Y coordinate for tap or swipe start' },
        x2: { type: 'number', description: 'X coordinate for swipe end' },
        y2: { type: 'number', description: 'Y coordinate for swipe end' },
        duration: { type: 'number', description: 'Swipe duration in ms (default 300)' },
        text: { type: 'string', description: 'Text string to type into focused input' },
        keycode: { type: 'string', description: 'Keycode name or number (e.g. "KEYCODE_BACK", "4", "66", "KEYCODE_HOME")' },
      },
      required: ['action'],
    },
    handler: async (args) => {
      const device = args.device ? String(args.device) : undefined;
      const action = String(args.action);

      if (action === 'tap') {
        const x = Math.round(Number(args.x) || 0);
        const y = Math.round(Number(args.y) || 0);
        await runAdb([...targetArgs(device), 'shell', 'input', 'tap', String(x), String(y)], adbBinary);
        return { content: [{ type: 'text', text: `Tapped at (${x}, ${y})` }] };
      }

      if (action === 'text') {
        const text = String(args.text || '').replace(/\s/g, '%s');
        await runAdb([...targetArgs(device), 'shell', 'input', 'text', text], adbBinary);
        return { content: [{ type: 'text', text: `Typed text into focused element` }] };
      }

      if (action === 'swipe') {
        const x1 = Math.round(Number(args.x) || 0);
        const y1 = Math.round(Number(args.y) || 0);
        const x2 = Math.round(Number(args.x2) || 0);
        const y2 = Math.round(Number(args.y2) || 0);
        const duration = Math.round(Number(args.duration) || 300);
        await runAdb([...targetArgs(device), 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(duration)], adbBinary);
        return { content: [{ type: 'text', text: `Swiped from (${x1}, ${y1}) to (${x2}, ${y2}) in ${duration}ms` }] };
      }

      if (action === 'keyevent') {
        const keycode = String(args.keycode || '4');
        await runAdb([...targetArgs(device), 'shell', 'input', 'keyevent', keycode], adbBinary);
        return { content: [{ type: 'text', text: `Dispatched keyevent ${keycode}` }] };
      }

      throw new Error(`Unsupported input action: ${action}`);
    },
  };

  return [listDevicesTool, takeScreenshotTool, dumpUiHierarchyTool, getLogcatTool, launchAppTool, sendInputTool];
}

export function startAndroidServer(adbBinary: string = 'adb'): McpServer {
  const tools = createAndroidTools(adbBinary);
  const server = new McpServer({
    name: 'android-emulator-mcp',
    version: '1.0.0',
    tools,
  });
  server.startStdio();
  return server;
}

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  startAndroidServer();
}
