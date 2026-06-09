import { startRotatingDisplayServer } from "./server.js";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : 3010;

async function main(): Promise<void> {
  const server = await startRotatingDisplayServer(port);
  console.log("🟢 Glanceboard");
  console.log(`🌐 ${server.url}`);
  console.log(`🔁 ${server.url}/api/rotation`);
  console.log("▶️ backend rotation running when auto-send is on");

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
