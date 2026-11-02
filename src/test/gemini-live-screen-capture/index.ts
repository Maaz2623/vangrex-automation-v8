import { GoogleGenAI, Modality } from "@google/genai";
import { ScreenCapture } from "./screen-capture";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!apiKey) {
  throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY in environment");
}

const ai = new GoogleGenAI({ apiKey });

const model = "gemini-3.8-live";

async function main() {
  let session: Awaited<ReturnType<typeof ai.live.connect>> | undefined;
  let screenCapture: ScreenCapture | undefined;

  let connected = false;
  let processingFrame = false;
  let shuttingDown = false;

  let fullTranscript = "";

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("\nStopping screen capture...");

    try {
      await screenCapture?.stop();
    } catch (error) {
      console.error("Screen capture stop error:", error);
    }

    try {
      session?.close();
    } catch {
      // Session may already be closed.
    }

    console.log("Stopped.");
  };

  process.once("SIGINT", () => {
    void shutdown();
  });

  session = await ai.live.connect({
    model,

    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},

      systemInstruction: `
You are Vangrex, a desktop screen assistant.

Analyze the actual screenshot supplied by the user.
Describe what is visibly on the screen.
If the user asks a question, answer based on the screenshot.
Never claim you cannot see the screen when an image has been supplied.
If the screenshot is missing or unreadable, explain that honestly.
Keep your response concise and useful.
      `.trim(),
    },

    callbacks: {
      onopen: () => {
        connected = true;
        console.log("Gemini Live connected.");
      },

      onmessage: (message) => {
        const content = message.serverContent;

        // Collect spoken response transcription.
        const transcript = content?.outputTranscription?.text;

        if (transcript) {
          fullTranscript += transcript;
          process.stdout.write(transcript);
        }

        if (content?.turnComplete) {
          console.log("\n\n--- Response complete ---");
          console.log("Transcript:", fullTranscript || "(No transcript)");
          console.log(message.usageMetadata?.promptTokenCount);

          fullTranscript = "";
          processingFrame = false;
        }

        console.log(message.usageMetadata?.promptTokenCount);
      },

      onerror: (error) => {
        console.error("\nGemini Live error:", error.message);
        processingFrame = false;
      },

      onclose: (event) => {
        connected = false;
        processingFrame = false;

        console.log("\nGemini Live disconnected:", event.reason);
      },
    },
  });

  screenCapture = new ScreenCapture();

  await screenCapture.start(async (frame) => {
    if (shuttingDown || !connected || !session) {
      return;
    }

    // Do not submit another screenshot while Gemini is responding.
    if (processingFrame) {
      console.log("[Vangrex] Skipping frame; previous response is pending.");
      return;
    }

    processingFrame = true;
    fullTranscript = "";

    try {
      console.log(
        `\n[Vangrex] Sending screenshot captured at ${new Date(
          frame.timestamp,
        ).toLocaleTimeString()}`,
      );

      // Submit the image and question together as a single turn.
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: "Describe what is currently visible on my desktop screen.",
              },
              {
                inlineData: {
                  mimeType: frame.mimeType,
                  data: frame.data,
                },
              },
            ],
          },
        ],
        turnComplete: true,
      });
    } catch (error) {
      processingFrame = false;
      console.error("[Vangrex] Failed to send screenshot:", error);
    }
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
