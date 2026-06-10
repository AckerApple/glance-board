import { startRotatingDisplayServer } from "./server.js";
import { errorWithClock, installClockedConsole, logWithClock } from "../hardware/logging.js";

installClockedConsole();

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : 3010;

async function main(): Promise<void> {
  const server = await startRotatingDisplayServer(port);
  logWithClock("🟢 Glanceboard");
  logWithClock(`🌐 ${server.url}`);
  logWithClock(`🔁 ${server.url}/api/rotation`);
  logWithClock("▶️ backend rotation running when auto-send is on");

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  errorWithClock(error);
  process.exit(1);
});
