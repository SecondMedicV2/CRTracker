export function RequestState({ loading, error, retry, empty }: { loading: boolean; error: string; retry: () => void; empty?: string }) {
  if (error) return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p role="alert">{error}</p>
      <button type="button" className="mt-2 font-semibold underline" onClick={retry}>Try again</button>
    </div>
  );
  const message = loading ? "Loading…" : empty;
  return message ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">{message}</p> : null;
}
