/**
 * Licenze delle risorse (immagini, texture, modelli, addon) e politica d'uso.
 * Principio: ciò che non ha una licenza esplicita è "tutti i diritti riservati" e non può essere convertito né redistribuito.
 * Questo modulo è isomorfo (usato anche dal browser per mostrare i badge).
 */

export type LicenseId =
  | "cc0" | "public-domain" | "cc-by" | "cc-by-sa" | "cc-by-nd" | "cc-by-nc" | "cc-by-nc-sa" | "cc-by-nc-nd"
  | "mit" | "apache-2.0" | "bsd" | "gpl" | "lgpl" | "mpl" | "unlicense" | "gfdl"
  | "sketchfab-standard" | "sketchfab-editorial" | "all-rights-reserved" | "unknown";

export interface LicensePolicy {
  /** è consentito creare opere derivate (conversione, voxelizzazione, modifica) */
  derivatives: boolean;
  /** è consentito l'uso commerciale */
  commercial: boolean;
  /** serve citare autore e fonte */
  attribution: boolean;
  /** i derivati devono usare la stessa licenza */
  shareAlike: boolean;
  /** è consentito ridistribuire (es. dentro un .mcaddon) */
  redistribution: boolean;
}

export interface LicenseInfo {
  id: LicenseId;
  label: string;
  version?: string;
  url?: string;
  policy: LicensePolicy;
}

const P = (d: boolean, c: boolean, a: boolean, sa: boolean, r: boolean): LicensePolicy => ({ derivatives: d, commercial: c, attribution: a, shareAlike: sa, redistribution: r });

const TABLE: Record<LicenseId, { label: string; policy: LicensePolicy; url?: (v?: string) => string }> = {
  "cc0": { label: "CC0 (dominio pubblico)", policy: P(true, true, false, false, true), url: () => "https://creativecommons.org/publicdomain/zero/1.0/" },
  "public-domain": { label: "Pubblico dominio", policy: P(true, true, false, false, true) },
  "cc-by": { label: "CC BY", policy: P(true, true, true, false, true), url: (v) => `https://creativecommons.org/licenses/by/${v ?? "4.0"}/` },
  "cc-by-sa": { label: "CC BY-SA", policy: P(true, true, true, true, true), url: (v) => `https://creativecommons.org/licenses/by-sa/${v ?? "4.0"}/` },
  "cc-by-nd": { label: "CC BY-ND", policy: P(false, true, true, false, true), url: (v) => `https://creativecommons.org/licenses/by-nd/${v ?? "4.0"}/` },
  "cc-by-nc": { label: "CC BY-NC", policy: P(true, false, true, false, true), url: (v) => `https://creativecommons.org/licenses/by-nc/${v ?? "4.0"}/` },
  "cc-by-nc-sa": { label: "CC BY-NC-SA", policy: P(true, false, true, true, true), url: (v) => `https://creativecommons.org/licenses/by-nc-sa/${v ?? "4.0"}/` },
  "cc-by-nc-nd": { label: "CC BY-NC-ND", policy: P(false, false, true, false, true), url: (v) => `https://creativecommons.org/licenses/by-nc-nd/${v ?? "4.0"}/` },
  "mit": { label: "MIT", policy: P(true, true, true, false, true), url: () => "https://opensource.org/license/mit" },
  "apache-2.0": { label: "Apache 2.0", policy: P(true, true, true, false, true), url: () => "https://www.apache.org/licenses/LICENSE-2.0" },
  "bsd": { label: "BSD", policy: P(true, true, true, false, true) },
  "gpl": { label: "GPL", policy: P(true, true, true, true, true) },
  "lgpl": { label: "LGPL", policy: P(true, true, true, true, true) },
  "mpl": { label: "MPL 2.0", policy: P(true, true, true, true, true) },
  "unlicense": { label: "Unlicense", policy: P(true, true, false, false, true) },
  "gfdl": { label: "GFDL", policy: P(true, true, true, true, true) },
  "sketchfab-standard": { label: "Sketchfab Standard (licenza del negozio)", policy: P(true, true, false, false, false) },
  "sketchfab-editorial": { label: "Sketchfab Editorial", policy: P(true, false, false, false, false) },
  "all-rights-reserved": { label: "Tutti i diritti riservati", policy: P(false, false, true, false, false) },
  "unknown": { label: "Licenza sconosciuta", policy: P(false, false, true, false, false) },
};

export function licenseInfo(id: LicenseId, version?: string): LicenseInfo {
  const t = TABLE[id];
  return { id, label: version ? `${t.label} ${version}` : t.label, version, url: t.url?.(version), policy: t.policy };
}

/** Normalizza una stringa di licenza qualsiasi (Commons, Sketchfab, SPDX GitHub, Poly Haven...). */
export function parseLicense(raw: string | null | undefined): LicenseInfo {
  const s = (raw ?? "").toLowerCase().replace(/[_]/g, "-").trim();
  if (!s) return licenseInfo("unknown");
  const ver = /(\d\.\d)/.exec(s)?.[1];
  if (/^(cc0|cc-?zero)|cc0|creative commons zero|publicdomainzero/.test(s)) return licenseInfo("cc0");
  if (/public ?domain|pubblico dominio|^pd\b|pd-/.test(s)) return licenseInfo("public-domain");
  const cc = /(?:cc|creative commons)[\s-]*(?:attribution|by)([\s-]*(?:non[\s-]?commercial|nc))?([\s-]*(?:share[\s-]?alike|sa))?([\s-]*(?:no[\s-]?deriv\w*|nd))?/.exec(s)
    ?? /^(?:by)(-nc)?(-sa)?(-nd)?$/.exec(s);
  if (cc) {
    const nc = Boolean(cc[1]), sa = Boolean(cc[2]), nd = Boolean(cc[3]);
    const id = (["cc-by", nc ? "nc" : "", sa ? "sa" : "", nd ? "nd" : ""].filter(Boolean).join("-")) as LicenseId;
    return licenseInfo(id in TABLE ? id : "unknown", ver);
  }
  if (/^mit$|mit license|\bmit\b/.test(s)) return licenseInfo("mit");
  if (/apache/.test(s)) return licenseInfo("apache-2.0");
  if (/bsd/.test(s)) return licenseInfo("bsd");
  if (/lgpl/.test(s)) return licenseInfo("lgpl");
  if (/gpl/.test(s)) return licenseInfo("gpl");
  if (/mpl|mozilla/.test(s)) return licenseInfo("mpl");
  if (/unlicense/.test(s)) return licenseInfo("unlicense");
  if (/gfdl|gnu free documentation/.test(s)) return licenseInfo("gfdl");
  if (/^st$|standard/.test(s)) return licenseInfo("sketchfab-standard");
  if (/^ed$|editorial/.test(s)) return licenseInfo("sketchfab-editorial");
  if (/all rights reserved|copyright/.test(s)) return licenseInfo("all-rights-reserved");
  return licenseInfo("unknown");
}

export interface Credit {
  title: string;
  author?: string;
  sourceName: string;
  sourceUrl?: string;
  license: LicenseInfo;
  /** come è stata usata la risorsa */
  usage: "modello" | "addon" | "riferimento-ai" | "texture" | "immagine" | "documentazione";
}

export interface UseCheck {
  allowed: boolean;
  /** motivi di blocco (in italiano) */
  blocked: string[];
  /** avvisi non bloccanti */
  notes: string[];
  attributionRequired: boolean;
  /** licenza che il risultato deve mantenere (share-alike) */
  inheritedLicense?: LicenseInfo;
  nonCommercialOnly: boolean;
}

/**
 * Verifica se le risorse possono essere convertite e ridistribuite come pacchetto.
 * - "modello"/"addon"/"texture": entrano nel risultato → servono derivati + ridistribuzione.
 * - "riferimento-ai": immagine usata come input di un generatore → derivati necessari.
 * - "immagine"/"documentazione": solo consultazione, non bloccano.
 */
export function checkUse(credits: Credit[], intent: { commercial: boolean }): UseCheck {
  const blocked: string[] = [], notes: string[] = [];
  let inherited: LicenseInfo | undefined;
  let nonCommercialOnly = false;
  for (const c of credits) {
    if (c.usage === "immagine" || c.usage === "documentazione") continue;
    const p = c.license.policy;
    const name = `"${c.title}" (${c.license.label})`;
    if (!p.derivatives) blocked.push(`${name}: la licenza non consente opere derivate (conversione/modifica).`);
    if ((c.usage === "modello" || c.usage === "addon" || c.usage === "texture") && !p.redistribution) {
      blocked.push(`${name}: la licenza non consente la ridistribuzione nel pacchetto esportato.`);
    }
    if (!p.commercial) {
      nonCommercialOnly = true;
      if (intent.commercial) blocked.push(`${name}: uso commerciale non consentito.`);
      else notes.push(`${name}: solo uso non commerciale.`);
    }
    if (p.shareAlike) {
      if (inherited && inherited.id !== c.license.id) blocked.push(`${name}: share-alike incompatibile con ${inherited.label}.`);
      inherited = c.license;
      notes.push(`${name}: il risultato deve essere distribuito con la stessa licenza (${c.license.label}).`);
    }
    if (c.usage === "riferimento-ai") notes.push(`${name}: usata come riferimento per la generazione AI; attribuzione inclusa.`);
  }
  return {
    allowed: blocked.length === 0,
    blocked,
    notes,
    attributionRequired: credits.some((c) => c.license.policy.attribution && c.usage !== "documentazione"),
    inheritedLicense: inherited,
    nonCommercialOnly,
  };
}

export function creditsText(credits: Credit[], header: string) {
  const lines = [header, "", "Fonti, autori e licenze:", ""];
  for (const c of credits) {
    lines.push(`- ${c.title}`);
    if (c.author) lines.push(`  Autore: ${c.author}`);
    lines.push(`  Fonte: ${c.sourceName}${c.sourceUrl ? ` – ${c.sourceUrl}` : ""}`);
    lines.push(`  Licenza: ${c.license.label}${c.license.url ? ` – ${c.license.url}` : ""}`);
    lines.push(`  Uso: ${c.usage}`);
  }
  return lines.join("\n") + "\n";
}
