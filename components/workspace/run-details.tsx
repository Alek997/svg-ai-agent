import type { ChatMessage } from "@/lib/workspace/types";
import type { FlowEntry } from "@/lib/workspace/flow";

function Payload({ value }: { value: unknown }) {
  return <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-stone-500"><code>{JSON.stringify(value, null, 2)}</code></pre>;
}

function FlowPart({ entry }: { entry: FlowEntry }) {
  switch (entry.kind) {
    case "step": return <>
      <p className="text-stone-500">Step {entry.detail.step} · Model {entry.detail.status === "running" ? "started" : entry.detail.status === "completed" ? "finished" : "interrupted"}</p>
      {entry.detail.status !== "running" && <p className="mt-1 whitespace-pre-wrap break-words">{entry.detail.description}</p>}
    </>;
    case "tool": return <>
      <p className="text-stone-500">Step {entry.call.step} · {entry.call.status === "pending" ? "Preparing tool" : entry.call.status === "running" ? "Tool call" : "Tool result"} · {entry.call.name}</p>
      {entry.call.input && <Payload value={entry.call.input} />}
      {entry.call.output && ("ok" in entry.call.output
        ? entry.call.output.ok
          ? <div className="mt-1 space-y-2">
              {!entry.call.output.results.length && <p>No matching sources found.</p>}
              {entry.call.output.results.map(source => <div key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-stone-600 underline underline-offset-2">{source.title}</a>
                <p className="mt-1 whitespace-pre-wrap break-words text-stone-500">{source.content}</p>
              </div>)}
            </div>
          : <p className="mt-1 text-amber-700">{entry.call.output.error}</p>
        : <Payload value={entry.call.output} />)}
      {entry.call.error && <p className="mt-1 text-red-700">{entry.call.error}</p>}
    </>;
    case "response": return <>
      <p className="text-stone-500">Step {entry.step} · Model response</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{entry.text}</p>
    </>;
    case "preview": return <p>Preview updated · {entry.width} × {entry.height} · {entry.characters.toLocaleString()} SVG characters</p>;
    case "result": return <>
      <p className="text-stone-500">Final result · SVG validated and saved</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{entry.message}</p>
      <p className="mt-1">{entry.document.name} · {entry.document.width} × {entry.document.height}</p>
      <details className="mt-1"><summary className="cursor-pointer text-[10px] text-stone-400">SVG source</summary><Payload value={entry.document.source} /></details>
    </>;
    case "error": return <p className="text-red-700">Generation stopped · {entry.message}</p>;
  }
}

export function RunDetails({ message }: { message: ChatMessage }) {
  // Older browser-held replies only have grouped records; preserve their data
  // without claiming that their missing event order can be reconstructed.
  const legacy: FlowEntry[] = [
    ...(message.steps ?? []).flatMap<FlowEntry>(detail => [
      { kind: "step", detail },
      ...(message.tools ?? []).filter(call => call.step === detail.step).map(call => ({ kind: "tool" as const, call })),
    ]),
    ...(message.tools ?? []).filter(call => !message.steps?.some(detail => detail.step === call.step)).map(call => ({ kind: "tool" as const, call })),
  ];
  const flow = message.flow ?? legacy;
  return (
    <details className="group mb-2 text-[11px] leading-5 text-stone-400">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-0.5 transition-colors hover:text-stone-600 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-[9px] transition-transform group-open:rotate-90">▸</span>
        Details
      </summary>
      <div className="mt-2 max-h-[60vh] space-y-3 overflow-auto border-l border-stone-100 pl-3" aria-label="Agent execution flow">
        {!message.flow && <p>Earlier tool records · full event order was not recorded.</p>}
        {!flow.length && <p>Waiting for the first model step…</p>}
        {flow.map((entry, index) => <div key={index}><FlowPart entry={entry} /></div>)}
      </div>
    </details>
  );
}
