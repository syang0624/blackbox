"use client";

import type { BriefingCard as BriefingCardType, SessionStatus } from "@/types";

interface BriefingCardProps {
  briefing: BriefingCardType | null;
  status: SessionStatus;
  onHangUp: () => void;
}

export default function BriefingCard({ briefing, status, onHangUp }: BriefingCardProps) {
  const isHandoff = status === "handoff";

  if (!briefing) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="text-center text-zinc-600">
          <CardIcon className="mx-auto h-16 w-16" />
          <p className="mt-3 text-sm">Briefing card assembles during hold</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border p-5 transition-all duration-700 ${
        isHandoff
          ? "border-emerald-500/50 bg-zinc-950 shadow-[0_0_30px_rgba(16,185,129,0.15)]"
          : "border-zinc-800 bg-zinc-950"
      }`}
    >
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Briefing Card
        </p>
        <p className="mt-1 text-lg font-semibold text-zinc-100">
          {briefing.company}
        </p>
        <p className="text-sm text-zinc-400">{briefing.user_intent}</p>
      </div>

      {/* Fields */}
      <div className="flex-1 space-y-3">
        <Field label="Name" value={briefing.identity.name} />
        <Field
          label="Loyalty"
          value={`${briefing.identity.loyalty_program} #${briefing.identity.loyalty_number}`}
        />
        <Field
          label="Booking"
          value={`${briefing.booking.pnr} — ${briefing.booking.flight_number}`}
        />
        <Field label="Route" value={briefing.booking.route} />
        <Field label="Date" value={briefing.booking.date} />
        <Field
          label="Status"
          value={briefing.booking.status}
          valueClass="text-red-400 uppercase font-medium"
        />
        <Field
          label="Payment"
          value={`${briefing.payment.brand} ••${briefing.payment.last4}`}
        />
        <Field label="Location" value={briefing.context.user_location} />
        <Field
          label="Urgency"
          value={briefing.context.urgency}
          valueClass="text-amber-400"
        />
      </div>

      {/* Suggested opening */}
      {isHandoff && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-emerald-400">
            Say this
          </p>
          <p className="text-sm leading-relaxed text-zinc-100">
            &quot;{briefing.suggested_opening}&quot;
          </p>
        </div>
      )}

      {/* Handoff buttons */}
      {isHandoff && (
        <div className="mt-4 flex gap-3">
          <button className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500">
            I&apos;ve got it from here
          </button>
          <button
            onClick={onHangUp}
            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-red-600 hover:text-red-400"
          >
            End call
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span
        className={`text-right text-sm ${valueClass || "text-zinc-200"}`}
      >
        {value}
      </span>
    </div>
  );
}

function CardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}
