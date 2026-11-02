import { google } from "@ai-sdk/google";
import { generateText, isStepCount, tool } from "ai";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import z from "zod";

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

const task = "Click on Search in vs code.";

const result = await generateText({
  model: google("gemini-3.5-flash-lite"),
  instructions:
    "You are a helpful desktop assistant. Use the tools. Always Return in natural language.",
  prompt: task,
  stopWhen: isStepCount(10),
  tools: {
    list_running_applications: tool({
      description: "Use to get currently running applications",
      inputSchema: z.object({}),
      execute: async () => {
        const apps = await runAgentDesktop("list-apps");

        if (!apps.ok) {
          return {
            success: false,
            message: "Something went wrong.",
          };
        }

        return {
          success: true,
          message: `Runnning apps: ${JSON.stringify(apps.data, null, 2)}`,
        };
      },
    }),
    find_element: tool({
      description: "Use to get the complete snapshot of the application.",
      inputSchema: z.object({
        app: z
          .string()
          .describe("Name of the application and wether it is running."),
        elementName: z.string().describe("Name of the element"),
      }),
      execute: async ({ app, elementName }) => {
        const element = await runAgentDesktop(
          "find",
          "--app",
          app,
          "--name",
          elementName,
        );

        if (!element.ok) {
          return {
            success: false,
            message: `Error: ${element.error}`,
          };
        }

        await writeFile("element.json", element.data as string, "utf-8");

        return {
          success: true,
          message: `Snapshot: ${JSON.stringify(element.data)}`,
        };
      },
    }),
    click_element: tool({
      description: "Use to click elements.",
      inputSchema: z.object({
        ref: z.string().describe("Qualified ref from snapshot"),
      }),
      execute: async ({ ref }) => {
        const click = await runAgentDesktop("click", ref);

        if (!click.ok) {
          return {
            success: false,
            mesage: `Erro: ${click.error}`,
          };
        }

        return {
          success: true,
          message: `Clicked at ${ref}`,
        };
      },
    }),
  },
});

console.log(
  result.text,
  result.toolResults.map((call) => ({
    name: call.toolName,
    result: call.input,
  })),
  result.usage.inputTokens,
);
