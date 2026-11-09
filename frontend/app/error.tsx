"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div role="alert" className="max-w-sm space-y-3 rounded-lg bg-white p-6 text-center shadow">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-slate-700">The page could not be shown. Please try again.</p>
        <button className="rounded bg-slate-900 px-4 py-2 text-white" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
