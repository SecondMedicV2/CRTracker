import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-sm space-y-3 rounded-lg bg-white p-6 text-center shadow">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-slate-700">That page does not exist, or the link is out of date.</p>
        <Link className="inline-block rounded bg-slate-900 px-4 py-2 text-white" href="/">Go to the home page</Link>
      </div>
    </main>
  );
}
