"use client";

import type { SessionStatus, IvrDecision } from "@/types";

const STATUS_DISPLAY: Record<
  SessionStatus,
  { label: string; color: string; pulse: boolean }
> = {
  idle: { label: "Ready", color: "text-zinc-500", pulse: false },
  extracting: {
    label: "Preparing...",
    color: "text-blue-400",
    pulse: true,
  },
  dialing: { label: "Dialing...", color: "text-yellow-400", pulse: true },
  navigating: {
    label: "Navigating IVR",
    color: "text-orange-400",
    pulse: true,
  },
  on_hold: { label: "On Hold", color: "text-purple-400", pulse: true },
  handoff: {
    label: "Human Connected",
    color: "text-emerald-400",
    pulse: true,
  },
  done: { label: "Call Ended", color: "text-zinc-500", pulse: false },
};

interface PhoneUIProps {
  status: SessionStatus;
  company: string | null;
  ivrLog: IvrDecision[];
}

export default function PhoneUI({ status, company, ivrLog }: PhoneUIProps) {
  const display = STATUS_DISPLAY[status];
  const latestIvr = ivrLog[ivrLog.length - 1] ?? null;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      {/* Phone header */}
      <div className="mb-4 text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          {company ?? "BlackBox Phone"}
        </p>
        <div className="mt-2 flex items-center justify-center gap-2">
          {display.pulse && (
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                  status === "handoff" ? "bg-emerald-400" : "bg-blue-400"
                }`}
              />
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  status === "handoff" ? "bg-emerald-400" : "bg-blue-400"
                }`}
              />
            </span>
          )}
          <span className={`text-lg font-semibold ${display.color}`}>
            {display.label}
          </span>
        </div>
      </div>

      {/* Call timer / status area */}
      <div className="flex flex-1 flex-col items-center justify-center">
        {status === "idle" && (
          <div className="text-zinc-600">
            <PhoneIcon className="mx-auto h-16 w-16" />
            <p className="mt-3 text-sm">Waiting to dial...</p>
          </div>
        )}

        {status === "on_hold" && (
          <div className="text-center">
            <div className="mx-auto flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-purple-400"
                  style={{
                    height: `${12 + Math.random() * 20}px`,
                    animation: `pulse 1.${i + 2}s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
            <p className="mt-3 text-sm text-purple-300">Hold music playing</p>
          </div>
        )}

        {status === "handoff" && (
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-400/10">
              <PersonIcon className="h-10 w-10 text-emerald-400" />
            </div>
            <p className="mt-3 text-sm font-medium text-emerald-300">
              Human agent connected
            </p>
          </div>
        )}
      </div>

      {/* IVR decision log */}
      {ivrLog.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
            IVR Navigation
          </p>
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {ivrLog.map((entry, i) => (
              <div
                key={entry.id}
                className={`rounded-lg p-2 text-xs ${
                  i === ivrLog.length - 1
                    ? "border border-orange-500/30 bg-orange-500/10 text-orange-200"
                    : "bg-zinc-900 text-zinc-400"
                }`}
              >
                <p className="text-zinc-500">{entry.prompt_text}</p>
                <p className="mt-1 font-medium">→ {entry.decision}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest IVR prompt highlight */}
      {status === "navigating" && latestIvr && (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-orange-500/10 p-2">
          <KeypadIcon className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-medium text-orange-300">
            {latestIvr.decision}
          </span>
        </div>
      )}
    </div>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
      />
    </svg>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
      />
    </svg>
  );
}

function KeypadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
      />
    </svg>
  );
}
