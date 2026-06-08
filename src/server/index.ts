import { startRotatingDisplayServer } from "./server.js";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : 3010;

async function main(): Promise<void> {
  const server = await startRotatingDisplayServer(port);
  console.log("Glanceboard");
  console.log(`Web UI: ${server.url}`);
  console.log(`API: ${server.url}/api/rotation`);
  console.log(`Legacy NBA API alias: ${server.url}/api/nba-score`);
  console.log("Local-first data fetching and display rotation are running.");

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
