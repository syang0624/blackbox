"use client";

import { useEffect, useRef, useMemo, useCallback, use } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import PhoneUI from "@/components/PhoneUI";
import GraphView from "@/components/GraphView";
import BriefingCard from "@/components/BriefingCard";
import ReasoningLog from "@/components/ReasoningLog";
import { useSession, useSessionMock } from "@/hooks/useSession";

const ASIANA_DEMO_KEYWORDS = ["asiana", "suitcase"];

function isAsianaDemo(input: string): boolean {
  const lower = input.toLowerCase();
  return ASIANA_DEMO_KEYWORDS.some((kw) => lower.includes(kw));
}

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const userInput = searchParams.get("input") || "";
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isDemo = useMemo(() => isAsianaDemo(userInput), [userInput]);

  // Use mock hook for Asiana live demo, real hook for everything else
  const mock = useSessionMock(isDemo ? id : null);
  const real = useSession(!isDemo ? id : null);
  const {
    session,
    graph,
    ivrLog,
    briefing,
    reasoning,
    createSession,
  } = isDemo ? mock : real;
  const audioPlaying = isDemo ? mock.audioPlaying : false;
  const triggerHandoff = isDemo ? mock.triggerHandoff : () => {};

  useEffect(() => {
    if (userInput) {
      createSession(userInput);
    }
  }, [userInput, createSession]);

  // Play pre-recorded Asiana phone call audio when triggered (demo only)
  useEffect(() => {
    if (audioPlaying && audioRef.current) {
      audioRef.current.play().catch(() => {
        // Browser may block autoplay — user will need to interact
      });
    }
  }, [audioPlaying]);

  const handleHangUp = useCallback(() => {
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    router.push("/");
  }, [router]);

  const status = session?.status ?? "idle";

  return (
    <div className="flex h-screen flex-col bg-black">
      {/* Hidden audio element for pre-recorded call (demo only) */}
      {isDemo && (
        <audio
          ref={audioRef}
          src="/asiana_phone_call.m4a"
          preload="auto"
          onEnded={triggerHandoff}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <a href="/" className="text-lg font-bold text-zinc-100">
            Black<span className="text-emerald-400">Box</span>
          </a>
          {isDemo && (
            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Live Demo
            </span>
          )}
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
          onHangUp={handleHangUp}
        />

        {/* Center: Graph */}
        <GraphView data={graph} />

        {/* Right: Briefing Card */}
        <BriefingCard briefing={briefing} status={status} onHangUp={handleHangUp} />
      </div>

      {/* Bottom: Reasoning Log */}
      <div className="h-40 px-3 pb-3">
        <ReasoningLog entries={reasoning} />
      </div>
    </div>
  );
}
