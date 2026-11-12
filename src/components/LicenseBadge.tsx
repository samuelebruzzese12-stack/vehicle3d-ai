"use client";
import type { LicenseInfo } from "@/lib/licenses";
import { Badge } from "./ui";

export function LicenseBadge({ license, usable }: { license: LicenseInfo; usable?: boolean }) {
  const tone = usable === false ? "danger" : license.id === "unknown" || license.id === "all-rights-reserved" ? "danger" : license.policy.commercial ? "ok" : "warn";
  return <Badge tone={tone}>{license.label}{usable === false ? " · non utilizzabile" : !license.policy.commercial ? " · non commerciale" : ""}</Badge>;
}
