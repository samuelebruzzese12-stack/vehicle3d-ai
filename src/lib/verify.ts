import "server-only";
import JSZip from "jszip";
import sharp from "sharp";
import { readGlb } from "./mesh/io";
import { triangleCount } from "./mesh/scene";

export interface Check { name: string; ok: boolean; detail?: string }
export interface VerifyResult { ok: boolean; checks: Check[] }

const res = (checks: Check[]): VerifyResult => ({ ok: checks.every((c) => c.ok), checks });

export async function verifyGlb(buf: Uint8Array): Promise<VerifyResult & { triangles: number; nodes: string[] }> {
  const checks: Check[] = [];
  checks.push({ name: "Dimensione file", ok: buf.byteLength > 1024, detail: `${(buf.byteLength / 1e6).toFixed(2)} MB` });
  checks.push({ name: "Intestazione GLB", ok: Buffer.from(buf.subarray(0, 4)).toString("ascii") === "glTF" });
  let errors = -1, warnings = 0;
  try {
    // validatore ufficiale Khronos
    const validator = (await import("gltf-validator")) as unknown as { validateBytes: (b: Uint8Array, o?: object) => Promise<{ issues: { numErrors: number; numWarnings: number; messages: { code: string; message: string; severity: number }[] } }> };
    const report = await validator.validateBytes(new Uint8Array(buf), { maxIssues: 50, ignoredIssues: ["UNUSED_OBJECT"] });
    errors = report.issues.numErrors;
    warnings = report.issues.numWarnings;
    const first = report.issues.messages.find((m) => m.severity === 0);
    checks.push({ name: "Validatore glTF Khronos", ok: errors === 0, detail: `${errors} errori, ${warnings} avvisi${first ? ` – ${first.code}: ${first.message}` : ""}` });
  } catch (e) {
    checks.push({ name: "Validatore glTF Khronos", ok: false, detail: (e as Error).message });
  }
  let triangles = 0;
  let nodes: string[] = [];
  try {
    const doc = await readGlb(buf);
    triangles = triangleCount(doc);
    nodes = doc.getRoot().listNodes().map((n) => n.getName());
    checks.push({ name: "Rilettura e triangoli", ok: triangles > 100, detail: `${triangles.toLocaleString("it-IT")} triangoli` });
  } catch (e) {
    checks.push({ name: "Rilettura e triangoli", ok: false, detail: (e as Error).message });
  }
  return { ...res(checks), triangles, nodes };
}

export async function verifyObjZip(buf: Buffer): Promise<VerifyResult> {
  const checks: Check[] = [];
  try {
    const zip = await JSZip.loadAsync(buf);
    const objName = Object.keys(zip.files).find((f) => f.endsWith(".obj"));
    const mtlName = Object.keys(zip.files).find((f) => f.endsWith(".mtl"));
    checks.push({ name: "File OBJ e MTL presenti", ok: Boolean(objName && mtlName) });
    if (objName && mtlName) {
      const obj = await zip.file(objName)!.async("string");
      const mtl = await zip.file(mtlName)!.async("string");
      let v = 0, f = 0, bad = 0;
      for (const line of obj.split("\n")) {
        if (line.startsWith("v ")) v++;
        else if (line.startsWith("f ")) {
          f++;
          for (const tok of line.slice(2).trim().split(/\s+/)) {
            const i = Number(tok.split("/")[0]);
            if (!(i >= 1 && i <= v)) bad++;
          }
        }
      }
      checks.push({ name: "Vertici e facce", ok: v > 0 && f > 0, detail: `${v.toLocaleString("it-IT")} vertici, ${f.toLocaleString("it-IT")} facce` });
      checks.push({ name: "Indici facce validi", ok: bad === 0, detail: bad ? `${bad} indici fuori intervallo` : undefined });
      const maps = [...mtl.matchAll(/map_Kd (.+)/g)].map((m) => m[1].trim());
      const missing = maps.filter((m) => !zip.file(m));
      checks.push({ name: "Texture referenziate presenti", ok: missing.length === 0, detail: missing.length ? missing.join(", ") : `${maps.length} texture` });
    }
  } catch (e) {
    checks.push({ name: "Archivio ZIP leggibile", ok: false, detail: (e as Error).message });
  }
  return res(checks);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function verifyMcaddon(buf: Buffer): Promise<VerifyResult & { cubes: number; bones: string[] }> {
  const checks: Check[] = [];
  let cubes = 0;
  let bones: string[] = [];
  try {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const json: Record<string, Record<string, unknown>> = {};
    let parseErr = "";
    for (const n of names.filter((x) => x.endsWith(".json"))) {
      try {
        json[n] = JSON.parse(await zip.file(n)!.async("string"));
      } catch (e) {
        parseErr += `${n}: ${(e as Error).message}; `;
      }
    }
    checks.push({ name: "JSON validi", ok: !parseErr, detail: parseErr || `${Object.keys(json).length} file JSON` });
    const manifests = Object.entries(json).filter(([n]) => n.endsWith("/manifest.json"));
    const rp = manifests.find(([, m]) => (m.modules as { type: string }[])?.[0]?.type === "resources");
    const bp = manifests.find(([, m]) => (m.modules as { type: string }[])?.[0]?.type === "data");
    checks.push({ name: "Resource Pack + Behavior Pack", ok: Boolean(rp && bp) });
    if (rp && bp) {
      const uuids = manifests.flatMap(([, m]) => [(m.header as { uuid: string }).uuid, ...(m.modules as { uuid: string }[]).map((x) => x.uuid)]);
      checks.push({ name: "UUID univoci e validi", ok: uuids.every((u) => UUID_RE.test(u)) && new Set(uuids).size === uuids.length });
      const dep = (bp[1].dependencies as { uuid: string }[] | undefined)?.[0]?.uuid;
      checks.push({ name: "Dipendenza BP → RP", ok: dep === (rp[1].header as { uuid: string }).uuid });
      const minEng = (rp[1].header as { min_engine_version: number[] }).min_engine_version;
      checks.push({ name: "Versione minima motore ≥ 1.21", ok: minEng[0] === 1 && minEng[1] >= 21, detail: minEng.join(".") });
      const rpDir = rp[0].split("/")[0], bpDir = bp[0].split("/")[0];
      checks.push({ name: "pack_icon.png presenti", ok: Boolean(zip.file(`${rpDir}/pack_icon.png`) && zip.file(`${bpDir}/pack_icon.png`)) });

      const client = Object.entries(json).find(([n]) => n.startsWith(`${rpDir}/entity/`))?.[1]?.["minecraft:client_entity"] as { description: { identifier: string; textures: Record<string, string>; geometry: Record<string, string>; animations?: Record<string, string>; render_controllers: string[] } } | undefined;
      const beh = Object.entries(json).find(([n]) => n.startsWith(`${bpDir}/entities/`))?.[1]?.["minecraft:entity"] as { description: { identifier: string }; components: Record<string, unknown> } | undefined;
      checks.push({ name: "Entità client e server presenti", ok: Boolean(client && beh) });
      if (client && beh) {
        checks.push({ name: "Identificatore coerente", ok: client.description.identifier === beh.description.identifier, detail: beh.description.identifier });
        const texPath = `${rpDir}/${client.description.textures.default}.png`;
        const texFile = zip.file(texPath);
        let texOk = false, texDetail = "mancante";
        if (texFile) {
          const meta = await sharp(await texFile.async("nodebuffer")).metadata().catch(() => null);
          texOk = Boolean(meta?.width && meta.format === "png");
          texDetail = meta ? `${meta.width}×${meta.height} ${meta.format}` : "non leggibile";
        }
        checks.push({ name: "Texture entità valida", ok: texOk, detail: texDetail });
        const geoEntry = Object.entries(json).find(([n]) => n.startsWith(`${rpDir}/models/entity/`));
        const geo = (geoEntry?.[1]?.["minecraft:geometry"] as { description: { identifier: string; texture_width: number; texture_height: number }; bones: { name: string; cubes?: { origin: number[]; size: number[]; uv: Record<string, { uv: number[]; uv_size: number[] }> }[] }[] }[] | undefined)?.[0];
        checks.push({ name: "Geometria referenziata", ok: geo?.description.identifier === client.description.geometry.default, detail: geo?.description.identifier });
        if (geo) {
          bones = geo.bones.map((b) => b.name);
          let badCube = 0, badUv = 0;
          for (const b of geo.bones) for (const c of b.cubes ?? []) {
            cubes++;
            if (c.size.some((s) => !(s > 0)) || c.origin.some((o) => !Number.isFinite(o))) badCube++;
            for (const f of Object.values(c.uv)) if (f.uv[0] + f.uv_size[0] > geo.description.texture_width || f.uv[1] + f.uv_size[1] > geo.description.texture_height) badUv++;
          }
          checks.push({ name: "Cubi validi", ok: cubes > 0 && badCube === 0, detail: `${cubes.toLocaleString("it-IT")} cubi${badCube ? `, ${badCube} non validi` : ""}` });
          checks.push({ name: "UV entro la texture", ok: badUv === 0 });
          checks.push({ name: "Complessità per dispositivi Android", ok: cubes <= 12000, detail: cubes > 6000 ? "elevata: possibili cali di FPS su dispositivi economici" : "adeguata" });
          const animFile = Object.entries(json).find(([n]) => n.startsWith(`${rpDir}/animations/`))?.[1] as { animations: Record<string, { bones: Record<string, unknown> }> } | undefined;
          if (client.description.animations) {
            const animBones = Object.values(animFile?.animations ?? {}).flatMap((a) => Object.keys(a.bones));
            checks.push({ name: "Bone animati esistenti", ok: animBones.length > 0 && animBones.every((b) => bones.includes(b)), detail: `${animBones.length} ruote animate` });
          }
        }
        const rc = Object.entries(json).find(([n]) => n.startsWith(`${rpDir}/render_controllers/`))?.[1] as { render_controllers: Record<string, unknown> } | undefined;
        checks.push({ name: "Render controller presente", ok: Boolean(rc && client.description.render_controllers.every((r) => r in rc.render_controllers)) });
        const ride = beh.components["minecraft:rideable"] as { seat_count: number; seats: unknown[] } | undefined;
        checks.push({ name: "Veicolo guidabile (posti)", ok: Boolean(ride && ride.seats.length === ride.seat_count && "minecraft:input_ground_controlled" in beh.components), detail: ride ? `${ride.seat_count} posti` : undefined });
      }
    }
  } catch (e) {
    checks.push({ name: "Archivio .mcaddon leggibile", ok: false, detail: (e as Error).message });
  }
  return { ...res(checks), cubes, bones };
}
