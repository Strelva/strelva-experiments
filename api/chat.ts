import type { IncomingMessage, ServerResponse } from "node:http";
import { answerWithNavigator, NavigatorUnavailableError } from "../server/navigator.ts";
import { MAX_PROMPTS, type ChatRequest } from "../src/chat.ts";

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8_000) throw new Error("Request too large.");
  }
  return JSON.parse(body);
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) && messages.length >= 1 && messages.length <= MAX_PROMPTS && messages.every((message) => {
    if (!message || typeof message !== "object") return false;
    const turn = message as Record<string, unknown>;
    return turn.role === "user" && typeof turn.content === "string" && turn.content.trim().length >= 4 && turn.content.length <= 600;
  });
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.end(JSON.stringify({ error: "POST required." }));
    return;
  }
  try {
    const body = await readBody(request);
    if (!isChatRequest(body)) throw new Error("Send a valid message.");
    response.statusCode = 200;
    response.end(JSON.stringify(await answerWithNavigator(body)));
  } catch (error) {
    response.statusCode = error instanceof NavigatorUnavailableError ? 503 : 400;
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unable to answer." }));
  }
}
