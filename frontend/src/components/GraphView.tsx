"use client";

import { useEffect, useRef } from "react";
import type { GraphData } from "@/types";

const NODE_COLORS: Record<string, string> = {
  Person: "#3b82f6",
  Email: "#6b7280",
  Booking: "#f59e0b",
  Flight: "#f97316",
  Airline: "#ef4444",
  LoyaltyAccount: "#8b5cf6",
  PaymentMethod: "#10b981",
  Airport: "#06b6d4",
  Attachment: "#6b7280",
};

interface GraphViewProps {
  data: GraphData;
}

export default function GraphView({ data }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map()
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    const centerX = width / 2;
    const centerY = height / 2;

    // Assign positions to new nodes in a circle layout
    const positions = positionsRef.current;
    data.nodes.forEach((node, i) => {
      if (!positions.has(node.id)) {
        const angle = (i / Math.max(data.nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const radius = Math.min(width, height) * 0.32;
        positions.set(node.id, {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }
    });

    // Animate
    let animationFrame: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw edges
      data.edges.forEach((edge) => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Edge label
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        ctx.font = "9px monospace";
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.textAlign = "center";
        ctx.fillText(edge.type, mx, my - 4);
      });

      // Draw nodes
      data.nodes.forEach((node) => {
        const pos = positions.get(node.id);
        if (!pos) return;

        const color = NODE_COLORS[node.type] || "#6b7280";
        const radius = 20;

        // Glow
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = color + "20";
        ctx.fill();

        // Circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color + "30";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#e4e4e7";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const label =
          node.label.length > 14
            ? node.label.slice(0, 12) + "…"
            : node.label;
        ctx.fillText(label, pos.x, pos.y);

        // Type label below
        ctx.font = "8px monospace";
        ctx.fillStyle = color;
        ctx.fillText(node.type, pos.x, pos.y + radius + 12);
      });

      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [data]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950">
        <div className="text-center text-zinc-600">
          <GraphIcon className="mx-auto h-16 w-16" />
          <p className="mt-3 text-sm">
            Entity graph will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full rounded-2xl border border-zinc-800 bg-zinc-950"
    >
      <div className="absolute left-4 top-3 z-10">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Entity Graph
        </p>
        <p className="text-xs text-zinc-600">
          {data.nodes.length} nodes · {data.edges.length} edges
        </p>
      </div>
      <canvas ref={canvasRef} className="h-full w-full" />
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
