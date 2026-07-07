"use client";

import { useEffect, useRef, useMemo, useCallback, useState, use } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import PhoneUI from "@/components/PhoneUI";
import GraphView from "@/components/GraphView";
import BriefingCard from "@/components/BriefingCard";
import ReasoningLog from "@/components/ReasoningLog";
import { useSession, useSessionMock } from "@/hooks/useSession";

const ASIANA_DEMO_KEYWORDS = ["asiana", "suitcase"];

export const runtime = "edge";

function isAsianaDemo(input: string): boolean {
  const lower = input.toLowerCase();
  return ASIANA_DEMO_KEYWORDS.every((kw) => lower.includes(kw));
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
  const [showDemoEndPopup, setShowDemoEndPopup] = useState(false);

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
    if (isDemo && userInput) {
      createSession(userInput);
    }
  }, [isDemo, userInput, createSession]);

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
          onEnded={() => {
            triggerHandoff();
            setShowDemoEndPopup(true);
          }}
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

      {/* 4-area grid: phone | graph | briefing on top, reasoning across bottom */}
      <div
        className="flex-1 gap-2 overflow-hidden p-2"
        style={{
          display: "grid",
          gridTemplateColumns: "20% 1fr 25%",
          gridTemplateRows: "1fr 100px",
        }}
      >
        <div className="overflow-y-auto">
          <PhoneUI
            status={status}
            company={session?.detected_company ?? null}
            ivrLog={ivrLog}
            onHangUp={handleHangUp}
          />
        </div>

        <div className="overflow-hidden">
          <GraphView data={graph} />
        </div>

        <div className="overflow-y-auto">
          <BriefingCard briefing={briefing} status={status} onHangUp={handleHangUp} />
        </div>

        <div className="col-span-3">
          <ReasoningLog entries={reasoning} />
        </div>
      </div>

      {/* Demo end popup */}
      {showDemoEndPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="mx-4 max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
              <svg className="h-7 w-7 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-zinc-100">
              Demo call ended
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              This call was placed from Steven&apos;s phone. To prevent an actual
              conversation with an Asiana agent, the call has been stopped here.
            </p>
            <button
              onClick={handleHangUp}
              className="mt-6 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              Hang Up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
