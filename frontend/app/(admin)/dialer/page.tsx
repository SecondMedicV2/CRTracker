"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { TableFrame } from "@/components/TableFrame";
import { RequestState } from "@/components/RequestState";

type RecentCall = {
  id: number;
  at: string;
  caller_name: string;
  caller_id: number;
  mobile: string;
  patient_name: string;
  notes: string;
  reference_id: string;
  call_id: string;
};

export default function ManualDialer() {
  const me = useApi<any>("/auth/me");
  const { data: status } = useApi<any>("/integrations/status");
  const recentCalls = useApi<RecentCall[]>("/dialer/recent");

  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [calling, setCalling] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const keyPadDigits = [
    { num: "1", sub: "" },
    { num: "2", sub: "ABC" },
    { num: "3", sub: "DEF" },
    { num: "4", sub: "GHI" },
    { num: "5", sub: "JKL" },
    { num: "6", sub: "MNO" },
    { num: "7", sub: "PQRS" },
    { num: "8", sub: "TUV" },
    { num: "9", sub: "WXYZ" },
    { num: "*", sub: "" },
    { num: "0", sub: "+" },
    { num: "#", sub: "" }
  ];

  function handleDigitClick(digit: string) {
    if (digit === "+" && mobile === "") {
      setMobile("+91");
      return;
    }
    setMobile((prev) => (prev.length < 13 ? prev + digit : prev));
  }

  function handleBackspace() {
    setMobile((prev) => prev.slice(0, -1));
  }

  async function handleCall(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!mobile.trim()) {
      setFeedback({ ok: false, message: "Please enter a 10-digit mobile number." });
      return;
    }

    setCalling(true);
    setFeedback(null);

    try {
      const res = await api<any>("/dialer/call", {
        method: "POST",
        body: { mobile: mobile.trim(), name: name.trim(), notes: notes.trim() }
      });
      setFeedback({
        ok: true,
        message: res.message || `Outbound call initiated to ${name || mobile} via MyOperator.`
      });
      recentCalls.reload();
    } catch (err: any) {
      setFeedback({
        ok: false,
        message: err.message || "Failed to initiate outbound call via MyOperator."
      });
    } finally {
      setCalling(false);
    }
  }

  const myoperatorReady = status?.myoperator?.connected;
  const myoperatorUserId = me.data?.myoperator_user_id || "Default";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Manual Dialer</h1>
        <p className="mt-1 text-sm text-slate-600">
          Place direct outbound calls to patients or partners via MyOperator click-to-call.
        </p>
      </div>

      {/* Integration Notice */}
      {status && !myoperatorReady && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-1">
          <p className="font-bold">⚠️ MyOperator calling is not fully configured.</p>
          <p>An administrator must set all four required MyOperator Worker secrets: API Key, Secret Token, Company ID, and Public IVR ID (MYOPERATOR_PUBLIC_IVR_ID){status.myoperator?.missing?.length ? ` (Missing: ${status.myoperator.missing.join(", ")})` : ""}.</p>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
            feedback.ok ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">{feedback.ok ? "📞" : "⚠️"}</span>
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-bold underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* DIALPAD & CALL CONTROLS */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Outbound Dialer
            </span>
            <span className="text-xs font-medium text-slate-500">
              Operator ID: <span className="font-semibold text-slate-800">{myoperatorUserId}</span>
            </span>
          </div>

          <form onSubmit={handleCall} className="space-y-4">
            {/* Number Input */}
            <div>
              <label htmlFor="dialer-mobile" className="block text-xs font-bold text-slate-700 mb-1">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="dialer-mobile"
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/[^\d+]/g, ""))}
                  className="w-full rounded-xl border border-slate-300 py-3 pl-3 pr-10 font-mono text-lg font-bold text-slate-900 tracking-wide focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                  required
                />
                {mobile && (
                  <button
                    type="button"
                    onClick={() => setMobile("")}
                    aria-label="Clear number"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Visual Keypad */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              {keyPadDigits.map((k) => (
                <button
                  key={k.num}
                  type="button"
                  onClick={() => handleDigitClick(k.num)}
                  className="flex flex-col items-center justify-center h-13 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100 active:bg-slate-200 transition select-none"
                >
                  <span className="text-lg font-bold text-slate-800 leading-none">{k.num}</span>
                  {k.sub && <span className="text-[10px] font-semibold text-slate-500 tracking-wider leading-none mt-0.5">{k.sub}</span>}
                </button>
              ))}
            </div>

            {/* Backspace Button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleBackspace}
                disabled={!mobile}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-30 transition flex items-center gap-1"
              >
                <span>⌫ Delete</span>
              </button>
            </div>

            {/* Optional Details */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label htmlFor="dialer-name" className="block text-xs font-bold text-slate-700 mb-1">
                  Recipient / Patient Name <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="dialer-name"
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label htmlFor="dialer-notes" className="block text-xs font-bold text-slate-700 mb-1">
                  Call Purpose / Notes <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="dialer-notes"
                  type="text"
                  placeholder="e.g. Follow-up on recent Thyrocare test report"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>
            </div>

            {/* Dial Action */}
            <button
              type="submit"
              disabled={calling || !mobile.trim()}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-teal-700 py-3 px-4 text-base font-bold text-white shadow-sm hover:bg-teal-800 transition disabled:opacity-50"
            >
              <span>📞</span>
              <span>{calling ? "Connecting via MyOperator…" : "Dial Now"}</span>
            </button>
            <p className="text-[11px] text-center text-slate-500">
              MyOperator rings your device first, then connects to the recipient.
            </p>
          </form>
        </div>

        {/* RECENT CALL LOG */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Recent Manual Calls</h2>
            <button
              type="button"
              onClick={() => recentCalls.reload()}
              className="text-xs font-semibold text-sky-700 hover:underline"
            >
              ↻ Refresh
            </button>
          </div>

          <RequestState
            loading={!recentCalls.data}
            error={recentCalls.error}
            retry={recentCalls.reload}
            empty={recentCalls.data?.length === 0 ? "No manual calls placed yet." : undefined}
          />

          {!recentCalls.error && !!recentCalls.data?.length && (
            <TableFrame label="Recent manual calls">
              <table className="w-full bg-white text-left text-sm shadow rounded-xl overflow-hidden">
                <thead className="bg-slate-50 text-slate-700 border-b">
                  <tr>
                    <th className="p-3">Time</th>
                    <th>Recipient</th>
                    <th>Number</th>
                    <th>Caller</th>
                    <th>Notes</th>
                    <th className="text-right p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.data.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-slate-50/70 transition">
                      <td className="p-3 text-xs text-slate-600 whitespace-nowrap">
                        {new Date(c.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </td>
                      <td className="font-semibold text-slate-900 text-xs">
                        {c.patient_name || "Customer"}
                      </td>
                      <td className="font-mono text-xs text-slate-700">
                        {c.mobile}
                      </td>
                      <td className="text-xs text-slate-600">
                        {c.caller_name || "Admin"}
                      </td>
                      <td className="text-xs text-slate-500 max-w-xs truncate" title={c.notes}>
                        {c.notes || "—"}
                      </td>
                      <td className="text-right p-3">
                        <button
                          type="button"
                          onClick={() => {
                            setName(c.patient_name === "Customer" ? "" : c.patient_name);
                            setNotes(c.notes);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className="rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 transition"
                        >
                          Redial
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </div>
      </div>
    </div>
  );
}
