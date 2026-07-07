"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ASIANA_DEMO_KEYWORDS = ["asiana", "suitcase"];

function isAsianaDemo(input: string): boolean {
  const lower = input.toLowerCase();
  return ASIANA_DEMO_KEYWORDS.every((kw) => lower.includes(kw));
}

export default function Home() {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;

    setIsSubmitting(true);

    const userInput = input.trim();
    if (isAsianaDemo(userInput)) {
      const sessionId = crypto.randomUUID();
      router.push(`/session/${sessionId}?input=${encodeURIComponent(userInput)}`);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: userInput }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const session = (await res.json()) as Session;
      router.push(`/session/${session.id}?input=${encodeURIComponent(userInput)}`);
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-100">
            Black<span className="text-emerald-400">Box</span>
          </h1>
          <p className="mt-3 text-lg text-zinc-500">
            AI concierge for customer service calls
          </p>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What's going on?"
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-6 py-5 text-lg text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
              autoFocus
              disabled={isSubmitting}
            />
            <button
              type="submit"
              disabled={!input.trim() || isSubmitting}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-30 disabled:hover:bg-emerald-600"
            >
              {isSubmitting ? "Starting..." : "Go"}
            </button>
          </div>
        </form>

        {/* Example prompts */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => setInput("Asiana broke my suitcase on my recent flight")}
            className="flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-400 transition-colors hover:border-emerald-600 hover:text-emerald-300"
          >
            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Live Demo
            </span>
            Asiana broke my suitcase on my recent flight
          </button>
        </div>

        {/* Permission notice */}
        <div className="mt-10 rounded-xl border border-zinc-800/50 bg-zinc-950/50 px-5 py-4 text-center">
          <p className="text-sm text-zinc-400">
            The Asiana prompt runs the polished live demo. Other prompts connect to the backend and generate a generic support briefing.
          </p>
          <p className="mt-1.5 text-sm text-zinc-500">
            To schedule a live demo, reach out to{" "}
            <span className="font-medium text-emerald-400">(41five) 75seven nine2three5</span>
          </p>
        </div>
      </div>
    </div>
  );
}
