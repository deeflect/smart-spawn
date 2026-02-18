import { mkdirSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { McpStore } from "./db.ts";
import { OpenRouterClient } from "./openrouter-client.ts";
import { RuntimeQueue } from "./runtime/queue.ts";
import { SmartSpawnClient } from "./smart-spawn-client.ts";
import { ArtifactStorage } from "./storage.ts";
import { registerToolHandlers } from "./tools.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  mkdirSync(config.homeDir, { recursive: true });
  const store = new McpStore(config.dbPath);
  const storage = new ArtifactStorage(config.homeDir, config.artifactsDir);
  const smartSpawn = new SmartSpawnClient(config.smartSpawnApiUrl);
  const openRouter = new OpenRouterClient(config.openRouterApiKey);
  const runtime = new RuntimeQueue(config, store, storage, smartSpawn, openRouter);
  await runtime.start();

  const server = new Server(
    {
      name: "smart-spawn-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerToolHandlers(server, runtime);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
