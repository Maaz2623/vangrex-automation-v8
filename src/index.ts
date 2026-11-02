import { spawn } from "node:child_process";

interface AgentDesktopResponse<T = unknown> {
  version: string;
  ok: boolean;
  command: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    disposition?: {
      delivery: string;
      retry: string;
    };
  };
}

async function runAgentDesktop<T = unknown>(
  ...args: string[]
): Promise<AgentDesktopResponse<T>> {
  return new Promise((resolve, reject) => {
    const child = spawn("agent-desktop", args, {
      // On Windows, this allows npm-installed command shims to run.
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      finishError(new Error("agent-desktop command timed out"));
    }, 30_000);

    function finishError(error: Error) {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finishError(new Error(`Failed to start agent-desktop: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;

      settled = true;
      clearTimeout(timeout);

      let response: AgentDesktopResponse<T>;

      try {
        response = JSON.parse(stdout.trim());
      } catch {
        reject(
          new Error(
            [
              `Could not parse agent-desktop JSON.`,
              `Exit code: ${code}`,
              `stdout: ${stdout}`,
              `stderr: ${stderr}`,
            ].join("\n"),
          ),
        );
        return;
      }

      // Structured CLI errors are returned as values rather than discarded.
      resolve(response);
    });
  });
}

async function main() {
  // Example 1: Check agent-desktop status.
  const status = await runAgentDesktop("status");

  console.log("STATUS:");
  console.dir(status, { depth: null });

  if (!status.ok) {
    console.error("Status command failed:", status.error);
    return;
  }

  // Example 2: List running/available applications.
  const apps = await runAgentDesktop("list-apps");

  console.log("\nAPPLICATIONS:");
  console.dir(apps.data, { depth: null });

  if (!apps.ok) {
    console.error("Could not list applications:", apps.error);
    return;
  }

  // Example 3: Read the interactive UI tree of VS Code.
  const snapshot = await runAgentDesktop("snapshot", "--app", "Code", "-i");

  console.log("\nSNAPSHOT:");
  console.dir(snapshot, { depth: null });

  if (!snapshot.ok) {
    console.error("Snapshot failed:", snapshot.error);
    return;
  }

  // Access the returned tree.
  const tree = (snapshot.data as { tree?: unknown } | undefined)?.tree;

  console.log("\nUI TREE:");
  console.dir(tree, { depth: null });
}

main().catch((error) => {
  console.error("Vangrex error:", error);
});
