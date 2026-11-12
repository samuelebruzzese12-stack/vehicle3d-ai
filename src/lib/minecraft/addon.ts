import "server-only";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import type { Segmentation } from "../mesh/segment";
import type { MergedBox, VoxelGrid } from "./voxel";

export const MIN_ENGINE: [number, number, number] = [1, 21, 0];
const CELL = 4; // px per colore nella texture palette
const COLS = 8;

export interface AddonInput {
  slug: string; // [a-z0-9_]
  displayName: string;
  grid: VoxelGrid;
  boxes: MergedBox[];
  seg: Segmentation;
  seats: { x: number; y: number; z: number }[];
  icon?: Buffer;
  description: string;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;

export async function paletteTexture(palette: VoxelGrid["palette"]) {
  const rows = Math.max(1, Math.ceil(palette.length / COLS));
  const w = COLS * CELL;
  let h = 16;
  while (h < rows * CELL) h *= 2;
  const raw = Buffer.alloc(w * h * 4);
  palette.forEach((c, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) raw.set(c, ((cy + y) * w + cx + x) * 4);
  });
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { png, width: w, height: h };
}

function uvFor(color: number) {
  return [(color % COLS) * CELL + 1, Math.floor(color / COLS) * CELL + 1];
}

/** Geometria Bedrock. Spazio canonico (anteriore +Z, sinistra +X) → Bedrock (anteriore −Z): rotazione di 180° su Y. */
export function buildGeometry(inp: AddonInput, tex: { width: number; height: number }) {
  const { grid, boxes, seg } = inp;
  const px = grid.size * 16;
  const toMc = (b: MergedBox) => {
    const x0 = grid.origin[0] + b.x * grid.size, y0 = grid.origin[1] + b.y * grid.size, z0 = grid.origin[2] + b.z * grid.size;
    const w = b.w * grid.size, h = b.h * grid.size, d = b.d * grid.size;
    return { origin: [r2(-(x0 + w) * 16), r2(y0 * 16), r2(-(z0 + d) * 16)], size: [r2(w * 16), r2(h * 16), r2(d * 16)] };
  };
  const byPart = new Map<number, MergedBox[]>();
  for (const b of boxes) byPart.set(b.part, [...(byPart.get(b.part) ?? []), b]);
  const bones: Record<string, unknown>[] = [{ name: "root", pivot: [0, 0, 0] }];
  for (const [p, list] of [...byPart.entries()].sort((a, b) => a[0] - b[0])) {
    const name = grid.labels[p];
    const wheel = seg.wheels.find((w) => w.name === name);
    const pivot = wheel ? [r2(-wheel.center[0] * 16), r2(wheel.center[1] * 16), r2(-wheel.center[2] * 16)] : [0, 0, 0];
    bones.push({
      name,
      parent: "root",
      pivot,
      cubes: list.map((b) => {
        const { origin, size } = toMc(b);
        const [u, v] = uvFor(b.color);
        const face = { uv: [u, v], uv_size: [2, 2] };
        return { origin, size, uv: { north: face, south: face, east: face, west: face, up: face, down: face } };
      }),
    });
  }
  const Lb = seg.dims.length, Wb = seg.dims.width, Hb = seg.dims.height;
  return {
    format_version: "1.16.0",
    "minecraft:geometry": [
      {
        description: {
          identifier: `geometry.vehicle3d.${inp.slug}`,
          texture_width: tex.width,
          texture_height: tex.height,
          visible_bounds_width: Math.ceil(Math.max(Lb, Wb) + 2),
          visible_bounds_height: Math.ceil(Hb + 2),
          visible_bounds_offset: [0, r2(Hb / 2), 0],
        },
        bones,
      },
    ],
    _voxel_px: px,
  };
}

export async function buildAddon(inp: AddonInput) {
  const { slug, displayName, seg } = inp;
  const id = `vehicle3d:${slug}`;
  const tex = await paletteTexture(inp.grid.palette);
  const geometry = buildGeometry(inp, tex);
  delete (geometry as Record<string, unknown>)._voxel_px;

  const rpHeader = randomUUID(), rpModule = randomUUID(), bpHeader = randomUUID(), bpModule = randomUUID();
  const version: [number, number, number] = [1, 0, 0];
  const rpManifest = {
    format_version: 2,
    header: { name: `${displayName} RP`, description: inp.description, uuid: rpHeader, version, min_engine_version: MIN_ENGINE },
    modules: [{ type: "resources", uuid: rpModule, version }],
    metadata: { generated_with: { vehicle3d_ai: ["1.0.0"] } },
  };
  const bpManifest = {
    format_version: 2,
    header: { name: `${displayName} BP`, description: inp.description, uuid: bpHeader, version, min_engine_version: MIN_ENGINE },
    modules: [{ type: "data", uuid: bpModule, version }],
    dependencies: [{ uuid: rpHeader, version }],
    metadata: { generated_with: { vehicle3d_ai: ["1.0.0"] } },
  };

  const wheelBones = seg.wheels.filter((w) => inp.grid.labels.includes(w.name));
  const animation = {
    format_version: "1.8.0",
    animations: {
      [`animation.vehicle3d.${slug}.wheels`]: {
        loop: true,
        bones: Object.fromEntries(
          wheelBones.map((w) => [w.name, { rotation: [`query.modified_distance_moved * ${r2(-57.2958 / Math.max(w.radius, 0.1))}`, 0, 0] }]),
        ),
      },
    },
  };
  const hasGlass = inp.boxes.some((b) => inp.grid.labels[b.part] === "glass");
  const body = inp.grid.palette[0] ?? [128, 128, 128, 255];
  const hex = (c: number[]) => "#" + c.slice(0, 3).map((x) => x.toString(16).padStart(2, "0")).join("");
  const clientEntity = {
    format_version: "1.10.0",
    "minecraft:client_entity": {
      description: {
        identifier: id,
        materials: { default: "entity_alphatest", glass: "entity_alphablend" },
        textures: { default: `textures/entity/vehicle3d/${slug}` },
        geometry: { default: `geometry.vehicle3d.${slug}` },
        ...(wheelBones.length ? { animations: { wheels: `animation.vehicle3d.${slug}.wheels` }, scripts: { animate: ["wheels"] } } : {}),
        render_controllers: [`controller.render.vehicle3d.${slug}`],
        spawn_egg: { base_color: hex(body), overlay_color: "#202020" },
      },
    },
  };
  const renderController = {
    format_version: "1.8.0",
    render_controllers: {
      [`controller.render.vehicle3d.${slug}`]: {
        geometry: "Geometry.default",
        materials: hasGlass ? [{ "*": "Material.default" }, { glass: "Material.glass" }] : [{ "*": "Material.default" }],
        textures: ["Texture.default"],
      },
    },
  };

  const seats = (inp.seats.length ? inp.seats : [{ x: seg.dims.width * 0.2, y: seg.dims.height * 0.35, z: 0 }]).slice(0, 8);
  const behavior = {
    format_version: "1.21.0",
    "minecraft:entity": {
      description: { identifier: id, is_spawnable: true, is_summonable: true, is_experimental: false },
      components: {
        "minecraft:type_family": { family: ["vehicle3d", "vehicle", "inanimate"] },
        "minecraft:collision_box": { width: r2(Math.min(seg.dims.width, 3.5)), height: r2(Math.min(seg.dims.height, 4)) },
        "minecraft:health": { value: 60, max: 60 },
        "minecraft:physics": {},
        "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: true },
        "minecraft:knockback_resistance": { value: 1 },
        "minecraft:movement": { value: 0.32 },
        "minecraft:movement.basic": {},
        "minecraft:navigation.walk": { avoid_water: true },
        "minecraft:jump.static": {},
        "minecraft:variable_max_auto_step": { base_value: 1.0625, controlled_value: 1.0625 },
        "minecraft:input_ground_controlled": {},
        "minecraft:rideable": {
          seat_count: seats.length,
          controlling_seat: 0,
          crouching_skip_interact: true,
          family_types: ["player"],
          interact_text: "action.interact.ride.horse",
          pull_in_entities: false,
          seats: seats.map((s) => ({ position: [r2(s.x), r2(Math.max(0.1, s.y - 0.35)), r2(s.z)] })),
        },
        "minecraft:damage_sensor": { triggers: [{ cause: "fall", deals_damage: "no" }, { cause: "suffocation", deals_damage: "no" }] },
        "minecraft:nameable": {},
        "minecraft:persistent": {},
        "minecraft:conditional_bandwidth_optimization": {},
      },
    },
  };

  const lang = (spawn: string) => `entity.${id}.name=${displayName}\nitem.spawn_egg.entity.${id}.name=${spawn} ${displayName}\npack.name=${displayName}\npack.description=${inp.description}\n`;
  const icon = inp.icon
    ? await sharp(inp.icon).resize(256, 256, { fit: "cover" }).png().toBuffer()
    : await sharp(tex.png).resize(256, 256, { kernel: "nearest" }).png().toBuffer();

  const files: Record<string, Buffer | string> = {
    [`${slug}_RP/manifest.json`]: JSON.stringify(rpManifest, null, 2),
    [`${slug}_RP/pack_icon.png`]: icon,
    [`${slug}_RP/entity/${slug}.entity.json`]: JSON.stringify(clientEntity, null, 2),
    [`${slug}_RP/models/entity/${slug}.geo.json`]: JSON.stringify(geometry),
    [`${slug}_RP/render_controllers/${slug}.render_controllers.json`]: JSON.stringify(renderController, null, 2),
    [`${slug}_RP/textures/entity/vehicle3d/${slug}.png`]: tex.png,
    [`${slug}_RP/texts/languages.json`]: JSON.stringify(["en_US", "it_IT"]),
    [`${slug}_RP/texts/en_US.lang`]: lang("Spawn"),
    [`${slug}_RP/texts/it_IT.lang`]: lang("Genera"),
    [`${slug}_BP/manifest.json`]: JSON.stringify(bpManifest, null, 2),
    [`${slug}_BP/pack_icon.png`]: icon,
    [`${slug}_BP/entities/${slug}.json`]: JSON.stringify(behavior, null, 2),
    [`${slug}_BP/texts/languages.json`]: JSON.stringify(["en_US", "it_IT"]),
    [`${slug}_BP/texts/en_US.lang`]: lang("Spawn"),
    [`${slug}_BP/texts/it_IT.lang`]: lang("Genera"),
  };
  if (wheelBones.length) files[`${slug}_RP/animations/${slug}.animation.json`] = JSON.stringify(animation, null, 2);

  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  const mcaddon = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { mcaddon, geometry, texturePng: tex.png, identifier: id, files: Object.keys(files) };
}
