import { FormEvent, useEffect, useRef, useState } from "react";
import { MAX_PROMPTS, type AssistantTurn, type ChatResponse, type UserTurn } from "./chat";
import { SOURCE_REVIEWED_AT } from "../skills/buffalo-business-navigator/config.ts";

const examples = [
  "I want to open a restaurant with a patio in Buffalo.",
  "I run a small construction company and want public work.",
  "We are a Buffalo software startup raising a seed round.",
] as const;

type ThreadTurn = UserTurn | AssistantTurn;

function SourceAnswer({ answer }: { answer: AssistantTurn }) {
  return (
    <section className="answer" aria-label="Navigator response">
      <div className="answer-mark" aria-hidden="true">B</div>
      <div className="answer-body">
        <p className="answer-summary">{answer.summary}</p>
        <ol className="sources">
          {answer.matches.map((match, index) => (
            <li key={match.id}>
              <a href={match.sourceUrl} target="_blank" rel="noreferrer">
                <span className="source-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="source-copy">
                  <strong>{match.name}</strong>
                  <span>{match.organization} · {match.kind}</span>
                  <span>{match.nextStep}</span>
                </span>
                <span className="source-arrow" aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ol>
        <p className="source-note">Official sources reviewed {SOURCE_REVIEWED_AT}. Confirm current terms with the program owner.</p>
      </div>
    </section>
  );
}

export function App() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ThreadTurn[]>([]);
  const [prompts, setPrompts] = useState<UserTurn[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const endRef = useRef<HTMLDivElement>(null);
  const limitReached = prompts.length >= MAX_PROMPTS;

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (content.length < 4 || status === "loading" || limitReached) return;
    const userTurn: UserTurn = { role: "user", content };
    const nextPrompts = [...prompts, userTurn];
    setDraft("");
    setPrompts(nextPrompts);
    setTurns((current) => [...current, userTurn]);
    setStatus("loading");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextPrompts }),
      });
      const body = await response.json() as ChatResponse | { error: string };
      if (!response.ok || !("answer" in body)) throw new Error("error" in body ? body.error : "Unable to answer.");
      setTurns((current) => [...current, body.answer]);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className={turns.length ? "has-thread" : ""}>
      <header>
        <a href="https://strelva.com/labs">Strelva Labs</a>
        <span>0.1.1 · Open experiment</span>
      </header>

      <div className="thread-shell">
        {!turns.length && (
          <section className="empty-state">
            <p>Buffalo Business Navigator</p>
            <h1>What does your<br />business need<span>?</span></h1>
            <p className="lede">Describe your goal. Get useful places to start from official Buffalo, Erie County, and New York State sources.</p>
          </section>
        )}

        <div className="timeline" aria-live="polite">
          {turns.map((turn, index) => turn.role === "user"
            ? <p className="user-turn" key={`${turn.content}-${index}`}>{turn.content}</p>
            : <SourceAnswer answer={turn} key={`${turn.summary}-${index}`} />)}
          {status === "loading" && <div className="thinking"><span>Checking official sources</span><i /></div>}
          {status === "error" && <div className="error" role="alert"><span>That did not come through.</span><button onClick={() => { setPrompts((current) => current.slice(0, -1)); setTurns((current) => current.slice(0, -1)); setStatus("idle"); }}>Try again</button></div>}
          <div ref={endRef} />
        </div>

        {limitReached && status === "idle" ? (
          <section className="limit" aria-label="Free thread complete">
            <div><p>Keep going with the source.</p><span>Take the experiment, change it, ship your own.</span></div>
            <div className="limit-actions">
              <a href="https://strelva.com/experiments/buffalo-business-navigator-0.1.1.zip">Download source</a>
              <a href="https://strelva.com/get-started">Work with Strelva</a>
            </div>
          </section>
        ) : (
          <form className="composer" onSubmit={submit}>
            <label htmlFor="prompt">{prompts.length ? "What else matters?" : "Describe what you’re trying to do"}</label>
            <textarea id="prompt" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={600} rows={2} placeholder={prompts.length ? "What should I do first?" : "I want to open a restaurant with a patio in Buffalo."} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <div className="composer-foot"><span>Buffalo · Erie County · New York</span><button disabled={draft.trim().length < 4 || status === "loading"} aria-label="Send prompt">↑</button></div>
          </form>
        )}

        {!turns.length && <div className="examples">{examples.map((example) => <button key={example} onClick={() => setDraft(example)}>{example}</button>)}</div>}
      </div>

      <footer><span>No account</span><a href="https://strelva.com/experiments/buffalo-business-navigator-0.1.1.zip">MIT · Source</a></footer>
    </main>
  );
}
