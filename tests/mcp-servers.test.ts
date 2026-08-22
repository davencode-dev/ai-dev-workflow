import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '../src/mcp/protocol.ts';
import { createWorkflowTools } from '../src/mcp/workflow-server.ts';
import { createAndroidTools, parseAdbDevices, parseHierarchySummary } from '../src/mcp/android-server.ts';

test('MCP Protocol: handles JSON-RPC 2.0 handshake, list and call lifecycle', async () => {
  const server = new McpServer({
    name: 'test-server',
    version: '1.0.0',
    tools: [
      {
        name: 'echo',
        description: 'Echo message back',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        handler: async (args) => ({
          content: [{ type: 'text', text: `Echo: ${String(args.message)}` }],
        }),
      },
    ],
  });

  // 1. Parse Error
  const parseErr = await server.handleMessage('{ invalid json');
  assert.ok(parseErr);
  const parseErrObj = JSON.parse(parseErr);
  assert.equal(parseErrObj.error.code, -32700);

  // 2. Initialize
  const initRes = await server.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    })
  );
  assert.ok(initRes);
  const initObj = JSON.parse(initRes);
  assert.equal(initObj.id, 1);
  assert.equal(initObj.result.serverInfo.name, 'test-server');
  assert.equal(initObj.result.protocolVersion, '2024-11-05');

  // 3. Notification (no id) returns null
  const notifRes = await server.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
  );
  assert.equal(notifRes, null);

  // 4. Tools List
  const listRes = await server.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })
  );
  assert.ok(listRes);
  const listObj = JSON.parse(listRes);
  assert.equal(listObj.id, 2);
  assert.equal(listObj.result.tools.length, 1);
  assert.equal(listObj.result.tools[0].name, 'echo');

  // 5. Tool Call (Success)
  const callRes = await server.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'hello world' } },
    })
  );
  assert.ok(callRes);
  const callObj = JSON.parse(callRes);
  assert.equal(callObj.id, 3);
  assert.equal(callObj.result.content[0].text, 'Echo: hello world');

  // 6. Tool Call (Not Found)
  const notFoundRes = await server.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'non_existent_tool', arguments: {} },
    })
  );
  assert.ok(notFoundRes);
  const notFoundObj = JSON.parse(notFoundRes);
  assert.equal(notFoundObj.error.code, -32601);

  // 7. Ping
  const pingRes = await server.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'ping',
    })
  );
  assert.ok(pingRes);
  const pingObj = JSON.parse(pingRes);
  assert.deepEqual(pingObj.result, {});
});

test('Workflow MCP Server: exposes orchestrator tools and executes list_repositories & get_latest_reports', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'mcp-workflow-test-'));
  try {
    await mkdir(join(tempDir, 'config'), { recursive: true });
    await mkdir(join(tempDir, '.agent-runs'), { recursive: true });

    await writeFile(
      join(tempDir, 'config/repositories.json'),
      JSON.stringify({
        repositories: [
          {
            id: 'sample-app',
            path: '/fake/sample-app',
            taskPrefix: 'SMP',
            taskResolver: { kind: 'file', path: 'tasks', pattern: '{id}-*.md' },
            validation: ['npm test'],
            androidBuild: 'npm run build:android:local',
            guidance: ['guidance/sample.md'],
            pilotEvidence: 'tasks.md',
            taskTracking: 'tasks.md',
            taskEvidenceDir: 'tasks/evidence',
          },
        ],
      })
    );

    await writeFile(
      join(tempDir, '.agent-runs/tasks-2026-08-22T20-00-00-000Z.json'),
      JSON.stringify({
        application: 'sample-app',
        startedAt: '2026-08-22T20:00:00.000Z',
        completedAt: '2026-08-22T20:01:00.000Z',
        status: 'SUCCESS',
        taskResults: [],
      })
    );

    const tools = createWorkflowTools(tempDir);
    const server = new McpServer({
      name: 'ai-dev-workflow-mcp',
      version: '1.0.0',
      tools,
    });

    // Verify tools list
    const listRes = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      })
    );
    const listObj = JSON.parse(listRes!);
    const toolNames = listObj.result.tools.map((t: { name: string }) => t.name);
    assert.ok(toolNames.includes('list_repositories'));
    assert.ok(toolNames.includes('create_tasks'));
    assert.ok(toolNames.includes('run_tasks'));
    assert.ok(toolNames.includes('verify_mobile'));
    assert.ok(toolNames.includes('get_latest_reports'));

    // Call list_repositories
    const reposRes = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'list_repositories', arguments: {} },
      })
    );
    const reposObj = JSON.parse(reposRes!);
    const reposData = JSON.parse(reposObj.result.content[0].text);
    assert.equal(reposData.length, 1);
    assert.equal(reposData[0].id, 'sample-app');

    // Call get_latest_reports
    const reportsRes = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_latest_reports', arguments: { limit: 5 } },
      })
    );
    const reportsObj = JSON.parse(reportsRes!);
    const reportsData = JSON.parse(reportsObj.result.content[0].text);
    assert.equal(reportsData.reports.length, 1);
    assert.equal(reportsData.reports[0].application, 'sample-app');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Android MCP Server: parser helpers for devices and UI hierarchy', () => {
  const sampleAdbOutput = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
R5CR30XYZ              device product:dm3q model:SM_S918B device:dm3q transport_id:2
unauth-123             unauthorized transport_id:3
`;

  const devices = parseAdbDevices(sampleAdbOutput);
  assert.equal(devices.length, 3);
  assert.equal(devices[0].serial, 'emulator-5554');
  assert.equal(devices[0].state, 'device');
  assert.equal(devices[0].model, 'sdk_gphone64_arm64');
  assert.equal(devices[1].serial, 'R5CR30XYZ');
  assert.equal(devices[1].model, 'SM_S918B');
  assert.equal(devices[2].serial, 'unauth-123');
  assert.equal(devices[2].state, 'unauthorized');

  const sampleXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.myapp" content-desc="" clickable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="Welcome to App" resource-id="com.myapp:id/title" class="android.widget.TextView" package="com.myapp" content-desc="app_title" clickable="false" bounds="[100,200][980,300]" />
    <node index="1" text="Submit" resource-id="com.myapp:id/btn_submit" class="android.widget.Button" package="com.myapp" content-desc="" clickable="true" bounds="[100,400][980,550]" />
  </node>
</hierarchy>`;

  const elements = parseHierarchySummary(sampleXml);
  assert.equal(elements.length, 2);
  assert.equal(elements[0].text, 'Welcome to App');
  assert.equal(elements[0].contentDesc, 'app_title');
  assert.equal(elements[0].resourceId, 'title');
  assert.equal(elements[1].text, 'Submit');
  assert.equal(elements[1].clickable, 'true');
  assert.equal(elements[1].resourceId, 'btn_submit');
});

test('Android MCP Server: tool registry has all tools and valid schemas', () => {
  const tools = createAndroidTools('mock-adb');
  const toolNames = tools.map((t) => t.name);

  assert.ok(toolNames.includes('list_devices'));
  assert.ok(toolNames.includes('take_screenshot'));
  assert.ok(toolNames.includes('dump_ui_hierarchy'));
  assert.ok(toolNames.includes('get_logcat'));
  assert.ok(toolNames.includes('launch_app'));
  assert.ok(toolNames.includes('send_input'));

  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
  }
});
