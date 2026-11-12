"use client";
import type { ReactNode } from "react";

export function Alert({ kind = "error", children }: { kind?: "error" | "warn" | "info" | "ok"; children: ReactNode }) {
  const cls = {
    error: "border-danger/40 bg-danger/10 text-danger",
    warn: "border-warn/40 bg-warn/10 text-warn",
    info: "border-line bg-panel-2 text-muted",
    ok: "border-accent/40 bg-accent/10 text-accent",
  }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden />
      {label}
    </span>
  );
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full bg-accent transition-all ${value == null ? "w-1/3 animate-pulse" : ""}`} style={value != null ? { width: `${Math.max(3, value)}%` } : undefined} />
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "danger" }) {
  const cls = { muted: "bg-panel-2 text-muted", ok: "bg-accent/15 text-accent", warn: "bg-warn/15 text-warn", danger: "bg-danger/15 text-danger" }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function Section({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-bold">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </header>
      {children}
      {actions && <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">{actions}</div>}
    </section>
  );
}
