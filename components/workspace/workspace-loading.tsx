const pulse = "animate-pulse motion-reduce:animate-none rounded-lg bg-stone-200/70";

export function WorkspaceSkeleton() {
  return <div role="status" aria-label="Loading saved conversation" aria-busy="true" className="grid flex-1 grid-cols-1 lg:h-[calc(100dvh-76px)] lg:flex-none lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_400px]">
    <span className="sr-only">Loading your saved artwork and conversation…</span>
    <section aria-label="Loading artwork" className="flex min-h-[556px] flex-col border-r border-stone-200">
      <div aria-hidden="true" className="flex h-[65px] items-center justify-between border-b border-stone-200 bg-white px-7"><div className={`${pulse} h-4 w-24`} /><div className={`${pulse} h-8 w-36`} /></div>
      <div aria-hidden="true" className="canvas-grid flex flex-1 items-center justify-center p-12"><div className={`${pulse} aspect-square w-64 max-w-full rounded-2xl`} /></div>
      <div aria-hidden="true" className="flex h-[61px] items-center justify-between border-t border-stone-200 bg-white px-7"><div className={`${pulse} h-4 w-32`} /><div className={`${pulse} h-8 w-28`} /></div>
    </section>
    <section aria-label="Loading messages" className="flex min-h-[500px] flex-col bg-white">
      <div aria-hidden="true" className="flex h-[65px] items-center border-b border-stone-200 px-5"><div className={`${pulse} h-4 w-32`} /></div>
      <div aria-hidden="true" className="flex-1 space-y-8 p-6">{[0, 1, 2].map(index => <div key={index} className="space-y-3"><div className={`${pulse} h-3 w-16`} /><div className={`${pulse} h-4 w-full`} /><div className={`${pulse} h-4 w-4/5`} /><div className={`${pulse} h-4 w-3/5`} /></div>)}</div>
      <div aria-hidden="true" className="p-5"><div className={`${pulse} h-24 w-full rounded-xl`} /></div>
    </section>
  </div>;
}

export function EmptySavedCanvas({ isLoading = false, activity = "Working…" }: { isLoading?: boolean; activity?: string }) {
  return <section aria-label="Canvas" className="canvas-grid flex min-h-[556px] flex-col items-center justify-center border-r border-stone-200 p-8 text-center">
    {isLoading && <div aria-hidden="true" className={`${pulse} mb-6 aspect-square w-64 max-w-full rounded-2xl`} />}
    <h2 role={isLoading ? "status" : undefined} className="text-sm font-medium text-stone-700">{isLoading ? activity : "No artwork yet"}</h2>
    <p className="mt-3 max-w-sm text-sm leading-6 text-stone-500">{isLoading ? "Your artwork is on its way." : "Continue this conversation to create an SVG. Your saved messages are shown in the conversation."}</p>
  </section>;
}
