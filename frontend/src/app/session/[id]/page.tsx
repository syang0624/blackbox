"use client";

import { useEffect, use } from "react";
import { useSearchParams } from "next/navigation";
import PhoneUI from "@/components/PhoneUI";
import GraphView from "@/components/GraphView";
import BriefingCard from "@/components/BriefingCard";
import ReasoningLog from "@/components/ReasoningLog";
import { useSessionMock } from "@/hooks/useSession";

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const userInput = searchParams.get("input") || "";

  const { session, graph, ivrLog, briefing, reasoning, createSession } =
    useSessionMock(id);

  useEffect(() => {
    if (userInput) {
      createSession(userInput);
    }
  }, [userInput, createSession]);

  const status = session?.status ?? "idle";

  return (
    <div className="flex h-screen flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold text-zinc-100">
            Black<span className="text-emerald-400">Box</span>
          </a>
          <span className="text-zinc-700">|</span>
          <span className="max-w-md truncate text-sm text-zinc-400">
            {userInput}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            {session?.detected_company}
          </span>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="grid flex-1 grid-cols-[280px_1fr_320px] gap-3 overflow-hidden p-3">
        {/* Left: Phone UI */}
        <PhoneUI
          status={status}
          company={session?.detected_company ?? null}
          ivrLog={ivrLog}
        />

        {/* Center: Graph */}
        <GraphView data={graph} />

        {/* Right: Briefing Card */}
        <BriefingCard briefing={briefing} status={status} />
      </div>

      {/* Bottom: Reasoning Log */}
      <div className="h-40 px-3 pb-3">
        <ReasoningLog entries={reasoning} />
      </div>
    </div>
  );
}
