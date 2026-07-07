"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;

    setIsSubmitting(true);

    // In production, this would call the backend to create a session.
    // For now, use a mock ID and pass the input via query param.
    const sessionId = crypto.randomUUID();
    router.push(
      `/session/${sessionId}?input=${encodeURIComponent(input.trim())}`
    );
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
          {[
            "My United flight to Chicago just got canceled",
            "I need a refund for my order",
            "My internet has been down for 2 days",
          ].map((example) => (
            <button
              key={example}
              onClick={() => setInput(example)}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
