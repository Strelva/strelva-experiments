import type { OpportunityMatch } from "./catalog.ts";
import { MAX_THREAD_MESSAGES } from "../skills/buffalo-business-navigator/config.ts";

export const MAX_PROMPTS = MAX_THREAD_MESSAGES;

export interface UserTurn {
  role: "user";
  content: string;
}

export interface AssistantTurn {
  role: "assistant";
  summary: string;
  matches: OpportunityMatch[];
  mode: "luna" | "catalog";
}

export interface ChatRequest {
  messages: UserTurn[];
}

export interface ChatResponse {
  answer: AssistantTurn;
}
