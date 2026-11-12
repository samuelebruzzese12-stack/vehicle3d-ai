import "server-only";
import { parseLicense, type Credit } from "../licenses";
import type { VehicleInput } from "../types";
import { getJson } from "./net";

const WD = "https://www.wikidata.org/w/api.php";
const SRC = "Wikidata";

type Snak = { mainsnak: { datavalue?: { value: unknown } }; rank?: string };
interface Entity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Snak[]>;
  sitelinks?: Record<string, { title: string }>;
}

async function entities(ids: string[], props = "labels|descriptions|claims|sitelinks"): Promise<Record<string, Entity>> {
  if (!ids.length) return {};
  const out: Record<string, Entity> = {};
  for (let i = 0; i < ids.length; i += 40) {
    const r = await getJson<{ entities: Record<string, Entity> }>(
      `${WD}?action=wbgetentities&ids=${ids.slice(i, i + 40).join("|")}&props=${props}&languages=it|en&format=json`, { source: SRC, retries: 5 });
    Object.assign(out, r.entities);
  }
  return out;
}

const label = (e?: Entity) => e?.labels?.it?.value ?? e?.labels?.en?.value ?? e?.id ?? "";
const values = (e: Entity, p: string) => (e.claims?.[p] ?? []).filter((c) => c.rank !== "deprecated").map((c) => c.mainsnak.datavalue?.value).filter((v) => v != null);
const itemIds = (e: Entity, p: string) => values(e, p).map((v) => (v as { id: string }).id).filter(Boolean);

const UNIT_TO_M: Record<string, number> = { Q11573: 1, Q174728: 0.01, Q174789: 0.001, Q218593: 0.0254, Q3710: 0.3048 };
function quantityMeters(e: Entity, p: string): number | undefined {
  const v = values(e, p)[0] as { amount: string; unit: string } | undefined;
  if (!v) return undefined;
  const unit = v.unit.split("/").pop()!;
  const f = UNIT_TO_M[unit];
  return f ? Number(v.amount) * f : undefined;
}
function year(e: Entity, ...ps: string[]): number | undefined {
  for (const p of ps) {
    const v = values(e, p)[0] as { time: string } | undefined;
    if (v) return Number(v.time.slice(1, 5));
  }
  return undefined;
}

/** Parole chiave (su etichette inglesi di P31/P279) → categoria dell'app. */
const CLASS_RULES: { re: RegExp; cat: VehicleInput["category"] }[] = [
  { re: /\btank\b|tank model|main battle tank|tank destroyer|light tank/i, cat: "carro_armato" },
  { re: /armou?red (personnel carrier|car|fighting vehicle)|infantry fighting vehicle|armoured vehicle|military vehicle/i, cat: "blindato" },
  { re: /\bbus\b|bus model|coach|trolleybus/i, cat: "autobus" },
  { re: /\btruck\b|lorry|truck model|tractor unit/i, cat: "camion" },
  { re: /\bvan\b|light commercial vehicle|minivan/i, cat: "furgone" },
  { re: /pickup/i, cat: "pickup" },
  { re: /motorcycle|scooter|motorbike/i, cat: "moto" },
  { re: /tractor/i, cat: "trattore" },
  { re: /sport utility|\bsuv\b|crossover/i, cat: "suv" },
  { re: /automobile|car model|\bcar\b|sedan|hatchback|coupé|coupe|station wagon|supermini|executive car|sports car|roadster/i, cat: "auto" },
  { re: /vehicle|locomotive|railcar|tram/i, cat: "altro" },
];

export interface WikiVehicle {
  qid: string;
  label: string;
  description: string;
  category: VehicleInput["category"];
  classes: string[];
  manufacturer?: string;
  make: string;
  model: string;
  yearFrom?: number;
  yearTo?: number;
  /** da dove provengono gli anni */
  yearsSource?: "wikidata" | "wikipedia-testo";
  brand?: string;
  dimensions_m?: { length: number; width: number; height: number };
  massKg?: number;
  crew?: number;
  commonsCategory?: string;
  image?: string;
  wikipedia: { lang: string; title: string; url: string; extract?: string }[];
  variants: { qid: string; label: string }[];
  score: number;
  sources: Credit[];
}

/** Identifica un veicolo dal nome tramite Wikidata (+ sintesi Wikipedia). Restituisce i candidati ordinati. */
export async function identifyByName(query: string, limit = 5): Promise<WikiVehicle[]> {
  const q = query.trim();
  const found = new Map<string, number>();
  for (const lang of ["it", "en"]) {
    const r = await getJson<{ search: { id: string; label?: string }[] }>(`${WD}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${lang}&uselang=${lang}&limit=10&type=item&format=json`, { source: SRC, retries: 5 });
    r.search.forEach((s, i) => found.set(s.id, Math.min(found.get(s.id) ?? 99, i)));
    // la seconda lingua serve solo se la prima non ha una corrispondenza esatta (meno richieste = meno limiti)
    if (r.search.some((s) => s.label?.toLowerCase() === q.toLowerCase())) break;
  }
  const ents = await entities([...found.keys()]);
  const classIds = new Set<string>();
  for (const e of Object.values(ents)) [...itemIds(e, "P31"), ...itemIds(e, "P279")].forEach((x) => classIds.add(x));
  const classEnts = await entities([...classIds], "labels");
  const enLabel = (id: string) => classEnts[id]?.labels?.en?.value ?? "";

  const candidates: WikiVehicle[] = [];
  for (const [id, rank] of found) {
    const e = ents[id];
    if (!e?.claims) continue;
    const classes = [...itemIds(e, "P31"), ...itemIds(e, "P279")].map(enLabel).filter(Boolean);
    const desc = e.descriptions?.en?.value ?? e.descriptions?.it?.value ?? "";
    const rule = CLASS_RULES.find((r) => classes.some((c) => r.re.test(c))) ?? CLASS_RULES.find((r) => r.re.test(desc));
    if (!rule) continue; // non è un veicolo
    const lbl = label(e);
    let score = 1 / (1 + rank);
    if (lbl.toLowerCase() === q.toLowerCase()) score += 1;
    else if (lbl.toLowerCase().includes(q.toLowerCase())) score += 0.4;
    if (e.sitelinks?.itwiki || e.sitelinks?.enwiki) score += 0.3;
    candidates.push({
      qid: id, label: lbl, description: e.descriptions?.it?.value ?? desc, category: rule.cat, classes,
      make: "", model: lbl, score, wikipedia: [], variants: [], sources: [],
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);

  // dettagli: produttore, anni, dimensioni, varianti, Wikipedia
  const manuIds = new Set<string>();
  top.forEach((c) => [...itemIds(ents[c.qid], "P176"), ...itemIds(ents[c.qid], "P1716")].forEach((m) => manuIds.add(m)));
  const manus = await entities([...manuIds], "labels");
  for (const c of top) {
    const e = ents[c.qid];
    const manu = itemIds(e, "P176")[0];
    c.manufacturer = manu ? label(manus[manu]) : undefined;
    const [L, W, H] = [quantityMeters(e, "P2043"), quantityMeters(e, "P2049"), quantityMeters(e, "P2048")];
    if (L && W && H) c.dimensions_m = { length: +L.toFixed(3), width: +W.toFixed(3), height: +H.toFixed(3) };
    const mass = values(e, "P2067")[0] as { amount: string; unit: string } | undefined;
    if (mass) c.massKg = Number(mass.amount) * (mass.unit.endsWith("Q191118") ? 1000 : 1); // Q191118 = tonnellata
    const crew = values(e, "P1029")[0] as { amount: string } | undefined;
    if (crew) c.crew = Number(crew.amount);
    c.yearFrom = year(e, "P729", "P571", "P580");
    c.yearTo = year(e, "P2669", "P730", "P582");
    if (c.yearFrom) c.yearsSource = "wikidata";
    const brandId = itemIds(e, "P1716")[0];
    c.brand = brandId ? label(manus[brandId]) : undefined;
    c.commonsCategory = values(e, "P373")[0] as string | undefined;
    c.image = values(e, "P18")[0] as string | undefined;
    // marca/modello: se l'etichetta inizia con il nome del produttore lo separiamo
    const brand = (c.brand ?? c.manufacturer)?.replace(/\s+(S\.p\.A\.|AG|GmbH|Inc\.?|Ltd\.?|Automobiles?|Motor Company)$/i, "") ?? "";
    const firstWord = brand.split(" ")[0];
    if (brand && c.label.toLowerCase().startsWith(brand.toLowerCase())) { c.make = brand; c.model = c.label.slice(brand.length).trim(); }
    else if (firstWord && c.label.toLowerCase().startsWith(firstWord.toLowerCase() + " ")) {
      const words = c.label.split(" ");
      const n = c.label.toLowerCase().startsWith(brand.toLowerCase().split(" ").slice(0, 2).join(" ").toLowerCase() + " ") ? 2 : 1;
      c.make = words.slice(0, n).join(" "); c.model = words.slice(n).join(" ");
    } else { c.make = brand || ""; c.model = c.label; }
    for (const lang of ["it", "en"]) {
      const sl = e.sitelinks?.[`${lang}wiki`];
      if (sl) c.wikipedia.push({ lang, title: sl.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(sl.title.replace(/ /g, "_"))}` });
    }
    c.sources.push({ title: `${c.label} (${c.qid})`, sourceName: "Wikidata", sourceUrl: `https://www.wikidata.org/wiki/${c.qid}`, license: parseLicense("CC0"), usage: "documentazione" });
  }

  // varianti (sottoclassi) e sintesi Wikipedia solo per il migliore candidato
  const best = top[0];
  if (best) {
    try {
      const r = await getJson<{ query: { search: { title: string }[] } }>(`${WD}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P279=${best.qid}`)}&srlimit=20&format=json`, { source: SRC });
      const vids = r.query.search.map((s) => s.title).filter((t) => /^Q\d+$/.test(t));
      const v = await entities(vids, "labels");
      best.variants = vids.map((id) => ({ qid: id, label: label(v[id]) })).filter((x) => x.label);
    } catch { /* varianti opzionali */ }
    for (const w of best.wikipedia) {
      try {
        const s = await getJson<{ extract?: string }>(`https://${w.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.title.replace(/ /g, "_"))}`, { source: "Wikipedia" });
        w.extract = s.extract;
        best.sources.push({ title: `Wikipedia (${w.lang}): ${w.title}`, sourceName: "Wikipedia", sourceUrl: w.url, license: parseLicense("CC BY-SA 4.0"), usage: "documentazione" });
      } catch { /* sintesi opzionale */ }
    }
    if (!best.yearFrom) {
      // anni dal testo (descrizione o sintesi Wikipedia), es. "prodotta dal 2005 al 2011", "produced from 2005 to 2011"
      const text = [best.description, ...best.wikipedia.map((w) => w.extract ?? "")].join(" ");
      const m = /(?:dal|from|between)\s+(1[89]\d\d|20\d\d)\s+(?:al|to|and|until)\s+(1[89]\d\d|20\d\d)/i.exec(text) ?? /(?:del|dal|from|since|in)\s+(1[89]\d\d|20\d\d)/i.exec(text);
      if (m) {
        best.yearFrom = Number(m[1]);
        best.yearTo = m[2] ? Number(m[2]) : undefined;
        best.yearsSource = "wikipedia-testo";
      }
    }
  }
  return top;
}

export function toVehicleInput(v: WikiVehicle): VehicleInput {
  return {
    make: v.make || v.manufacturer || v.label.split(" ")[0],
    model: v.model || v.label,
    year: v.yearFrom,
    category: v.category,
    dimensions_m: v.dimensions_m,
    seats: v.category === "carro_armato" || v.category === "blindato" ? v.crew : undefined,
  };
}
