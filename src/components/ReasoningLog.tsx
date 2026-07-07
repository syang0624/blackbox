"use client";

import { useEffect, useRef } from "react";
import type { ReasoningEntry } from "@/types";

const TYPE_STYLES: Record<ReasoningEntry["type"], string> = {
  info: "text-blue-400",
  decision: "text-orange-400",
  extraction: "text-emerald-400",
  error: "text-red-400",
};

const TYPE_PREFIX: Record<ReasoningEntry["type"], string> = {
  info: "INFO",
  decision: "DECIDE",
  extraction: "EXTRACT",
  error: "ERROR",
};

interface ReasoningLogProps {
  entries: ReasoningEntry[];
}

export default function ReasoningLog({ entries }: ReasoningLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <span className="relative flex h-2 w-2">
          {entries.length > 0 && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
        </span>
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Agent Reasoning
        </p>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs"
      >
        {entries.length === 0 ? (
          <p className="text-zinc-600">Waiting for agent activity...</p>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => {
              const time = new Date(entry.timestamp).toLocaleTimeString(
                "en-US",
                {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }
              );
              return (
                <div key={entry.id} className="flex gap-2">
                  <span className="shrink-0 text-zinc-600">{time}</span>
                  <span
                    className={`shrink-0 ${TYPE_STYLES[entry.type]}`}
                  >
                    [{TYPE_PREFIX[entry.type]}]
                  </span>
                  <span className="text-zinc-300">{entry.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
