import readline from 'node:readline';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export interface McpServerOptions {
  name: string;
  version: string;
  tools?: McpTool[];
}

export class McpServer {
  private readonly name: string;
  private readonly version: string;
  private readonly tools = new Map<string, McpTool>();

  constructor(options: McpServerOptions) {
    this.name = options.name;
    this.version = options.version;
    if (options.tools) {
      for (const tool of options.tools) {
        this.registerTool(tool);
      }
    }
  }

  registerTool(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  async handleMessage(messageText: string): Promise<string | null> {
    const trimmed = messageText.trim();
    if (!trimmed) {
      return null;
    }

    let request: Record<string, unknown>;
    try {
      request = JSON.parse(trimmed);
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      });
    }

    const id = request.id;
    const method = request.method;
    const params = (request.params || {}) as Record<string, unknown>;

    // Handle notifications (no id)
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized' || method === 'exit') {
        return null;
      }
      return null;
    }

    // Protocol Handshake: initialize
    if (method === 'initialize') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: this.name,
            version: this.version,
          },
        },
      });
    }

    // Tools Discovery: tools/list
    if (method === 'tools/list') {
      const toolsList = Array.from(this.tools.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          tools: toolsList,
        },
      });
    }

    // Tool Execution: tools/call
    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const tool = this.tools.get(toolName);

      if (!tool) {
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Tool '${toolName}' not found`,
          },
        });
      }

      const args = (params.arguments || {}) as Record<string, unknown>;
      try {
        const toolResult = await tool.handler(args);
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: toolResult,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error executing tool '${toolName}': ${errorMsg}` }],
            isError: true,
          },
        });
      }
    }

    // Ping
    if (method === 'ping') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {},
      });
    }

    // Method not found
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method '${String(method)}' not found`,
      },
    });
  }

  startStdio(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      try {
        const response = await this.handleMessage(line);
        if (response) {
          process.stdout.write(response + '\n');
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errResponse = JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: `Internal server error: ${errorMsg}` },
        });
        process.stdout.write(errResponse + '\n');
      }
    });

    rl.on('close', () => {
      process.exit(0);
    });

    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  }
}
