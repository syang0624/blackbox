"use client";

import { useEffect, useRef } from "react";
import type { GraphData, GraphNode } from "@/types";

const NODE_COLORS: Record<string, string> = {
  Person: "#3b82f6",
  Email: "#6b7280",
  Booking: "#f59e0b",
  Flight: "#f97316",
  Airline: "#ef4444",
  LoyaltyAccount: "#8b5cf6",
  PaymentMethod: "#10b981",
  Airport: "#06b6d4",
  Attachment: "#78716c",
};

const NODE_RADIUS = 24;
const TOTAL_EXPECTED = 9;

interface NodePosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
  node: GraphNode;
}

interface GraphViewProps {
  data: GraphData;
}

export default function GraphView({ data }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<Map<string, NodePosition>>(new Map());
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;

      if (w === 0 || h === 0) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Sync canvas size
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Reset transform, scale for retina, clear
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const positions = nodesRef.current;

      // Add positions for new nodes
      data.nodes.forEach((node) => {
        if (!positions.has(node.id)) {
          const idx = positions.size;
          const angle = (idx / TOTAL_EXPECTED) * Math.PI * 2 - Math.PI / 2;
          const spread = Math.min(w, h) * 0.28;
          positions.set(node.id, {
            x: cx + Math.cos(angle) * spread + (Math.random() - 0.5) * 20,
            y: cy + Math.sin(angle) * spread + (Math.random() - 0.5) * 20,
            vx: 0,
            vy: 0,
            node,
          });
        }
      });

      const allNodes = Array.from(positions.values());

      // --- Force simulation ---
      for (const n of allNodes) {
        n.vx += (cx - n.x) * 0.003;
        n.vy += (cy - n.y) * 0.003;
      }

      for (let i = 0; i < allNodes.length; i++) {
        for (let j = i + 1; j < allNodes.length; j++) {
          const a = allNodes[i];
          const b = allNodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = NODE_RADIUS * 5;
          if (dist < minDist) {
            const force = ((minDist - dist) / dist) * 0.5;
            a.vx += dx * force;
            a.vy += dy * force;
            b.vx -= dx * force;
            b.vy -= dy * force;
          }
        }
      }

      for (const edge of data.edges) {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = NODE_RADIUS * 4.5;
        const force = (dist - target) * 0.003;
        from.vx += (dx / dist) * force;
        from.vy += (dy / dist) * force;
        to.vx -= (dx / dist) * force;
        to.vy -= (dy / dist) * force;
      }

      const pad = NODE_RADIUS + 16;
      for (const n of allNodes) {
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(pad, Math.min(w - pad, n.x));
        n.y = Math.max(pad + 30, Math.min(h - pad - 16, n.y));
      }

      // --- Draw edges ---
      for (const edge of data.edges) {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) continue;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1;
        ctx.stroke();

        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        ctx.font = "8px monospace";
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(edge.type, mx, my - 5);
      }

      // --- Draw nodes ---
      for (const pos of allNodes) {
        const color = NODE_COLORS[pos.node.type] || "#6b7280";

        // Glow
        const grad = ctx.createRadialGradient(
          pos.x, pos.y, NODE_RADIUS * 0.3,
          pos.x, pos.y, NODE_RADIUS * 1.5
        );
        grad.addColorStop(0, color + "18");
        grad.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, NODE_RADIUS * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Fill
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = color + "20";
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = color + "99";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.font = "bold 10px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "#f4f4f5";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label =
          pos.node.label.length > 14
            ? pos.node.label.slice(0, 12) + "…"
            : pos.node.label;
        ctx.fillText(label, pos.x, pos.y);

        // Type below
        ctx.font = "bold 8px monospace";
        ctx.fillStyle = color;
        ctx.fillText(pos.node.type, pos.x, pos.y + NODE_RADIUS + 10);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [data]);

  if (data.nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950"
        style={{ width: "100%", height: "100%" }}
      >
        <div className="text-center text-zinc-600">
          <GraphIcon className="mx-auto h-12 w-12" />
          <p className="mt-2 text-sm">Entity graph will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl border border-zinc-800 bg-zinc-950"
      style={{ width: "100%", height: "100%" }}
    >
      <div className="absolute left-3 top-2 z-10 flex items-center gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">
          Entity Graph
        </p>
        <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2 py-0.5">
          <span className="text-[10px] tabular-nums text-emerald-400">
            {data.nodes.length}
          </span>
          <span className="text-[9px] text-zinc-600">nodes</span>
          <span className="text-zinc-700">·</span>
          <span className="text-[10px] tabular-nums text-blue-400">
            {data.edges.length}
          </span>
          <span className="text-[9px] text-zinc-600">edges</span>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </div>
  );
}

function GraphIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1}
      stroke="currentColor"
    >
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M7 6l3 5M17 6l-3 5M12 14v3" />
    </svg>
  );
}
