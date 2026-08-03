import { Codex } from "@openai/codex-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNavigatorPrompt, navigatorOutputSchema, parseNavigatorOutput } from "../skills/buffalo-business-navigator/agent.ts";
import { findOpportunities, OPPORTUNITIES, type OpportunityMatch } from "../skills/buffalo-business-navigator/catalog.ts";
import { NAVIGATOR_MODEL } from "../skills/buffalo-business-navigator/config.ts";
import { MAX_PROMPTS, type ChatRequest, type ChatResponse } from "../src/chat.ts";

export class NavigatorUnavailableError extends Error {
  override readonly name = "NavigatorUnavailableError";
}

function catalogAnswer(messages: ChatRequest["messages"]): ChatResponse {
  const context = messages.map(({ content }) => content).join(" ");
  return {
    answer: {
      role: "assistant",
      summary: messages.length === 2
        ? "With that follow-up included, these are the strongest official starting points. Confirm current terms with each program owner."
        : "These are the strongest official starting points I found. Confirm current terms with each program owner.",
      matches: findOpportunities(context).slice(0, 4),
      mode: "catalog",
    },
  };
}

export async function answerWithNavigator(request: ChatRequest): Promise<ChatResponse> {
  if (request.messages.length < 1 || request.messages.length > MAX_PROMPTS) throw new Error("This thread is complete.");
  const fallback = catalogAnswer(request.messages);
  const fixtureMode = process.env.NAVIGATOR_MODE === "fixture";
  if (fixtureMode) return fallback;

  const sourcePacket = OPPORTUNITIES.map(({ signals: _signals, ...opportunity }) => opportunity);
  const transcript = request.messages.map(({ content }, index) => `Prompt ${index + 1}: ${content}`).join("\n");
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "strelva-navigator-"));

  try {
    const codex = new Codex();
    const thread = codex.startThread({
      model: NAVIGATOR_MODEL,
      modelReasoningEffort: "low",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      workingDirectory: runtimeDirectory,
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    });
    const result = await thread.run(buildNavigatorPrompt(transcript, sourcePacket), { outputSchema: navigatorOutputSchema });
    const output = parseNavigatorOutput(result.finalResponse);
    if (!output) throw new Error("Navigator returned invalid structured output.");
    const selected = new Set(output.opportunityIds);
    const available = findOpportunities(transcript);
    const byId = new Map(available.map((match) => [match.id, match]));
    for (const match of fallback.answer.matches) byId.set(match.id, match);
    const matches = [...selected].map((id) => byId.get(id)).filter((match): match is OpportunityMatch => Boolean(match));
    return {
      answer: {
        role: "assistant",
        summary: output.summary,
        matches: matches.length ? matches : fallback.answer.matches,
        mode: "luna",
      },
    };
  } catch (error) {
    console.error("Navigator request failed", error);
    throw new NavigatorUnavailableError("Navigator is temporarily unavailable.");
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}
