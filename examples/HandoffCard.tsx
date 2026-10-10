/** A tiny component used for the real Codex → DeepSeek → Codex acceptance run. */
export function HandoffCard({title}:{title:string}){
 // "Submitted" is not "accepted": this only marks the handoff as sent for
 // review, and a reviewer must still accept it before it counts as done.
 return <article aria-label="Handoff submission"><h2>{title}</h2><p>Submitted — awaiting review</p><p>A command pass is not project acceptance.</p></article>;
}
