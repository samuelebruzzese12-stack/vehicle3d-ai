"use client";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

interface Cube { origin: number[]; size: number[]; uv: { north: { uv: number[] } } }
interface Geo { "minecraft:geometry": { bones: { name: string; cubes?: Cube[] }[] }[] }

function Boxes({ geo, palette, hidden }: { geo: Geo; palette: ImageData; hidden: Set<string> }) {
  const mesh = useMemo(() => {
    const cubes = geo["minecraft:geometry"][0].bones.filter((b) => !hidden.has(b.name)).flatMap((b) => (b.cubes ?? []).map((c) => ({ c, glass: b.name === "glass" })));
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    const im = new THREE.InstancedMesh(geom, mat, Math.max(1, cubes.length));
    const m = new THREE.Matrix4(), col = new THREE.Color();
    cubes.forEach(({ c }, i) => {
      const [ox, oy, oz] = c.origin, [sx, sy, sz] = c.size;
      m.makeScale(sx / 16, sy / 16, sz / 16).setPosition((ox + sx / 2) / 16, (oy + sy / 2) / 16, (oz + sz / 2) / 16);
      im.setMatrixAt(i, m);
      const [u, v] = c.uv.north.uv;
      const k = (v * palette.width + u) * 4;
      col.setRGB(palette.data[k] / 255, palette.data[k + 1] / 255, palette.data[k + 2] / 255, THREE.SRGBColorSpace);
      im.setColorAt(i, col);
    });
    im.count = cubes.length;
    return im;
  }, [geo, palette, hidden]);
  return <primitive object={mesh} />;
}

export default function MinecraftPreview({ geoUrl, paletteUrl }: { geoUrl: string; paletteUrl: string }) {
  const [geo, setGeo] = useState<Geo>();
  const [palette, setPalette] = useState<ImageData>();
  const [error, setError] = useState<string>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = (await (await fetch(geoUrl)).json()) as Geo;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = paletteUrl;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        if (alive) {
          setGeo(g);
          setPalette(ctx.getImageData(0, 0, img.width, img.height));
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [geoUrl, paletteUrl]);
  const bones = geo?.["minecraft:geometry"][0].bones.filter((b) => b.cubes?.length).map((b) => b.name) ?? [];
  if (error) return <p className="text-sm text-danger">Anteprima non disponibile: {error}</p>;
  return (
    <div className="space-y-2">
      <div className="h-80 overflow-hidden rounded-2xl border border-line bg-[linear-gradient(#7dd3fc,#bae6fd_60%,#4d7c0f_60%)] sm:h-[28rem]">
        {geo && palette && (
          <Canvas camera={{ position: [-5, 3, -6], fov: 40 }} dpr={[1, 2]}>
            <ambientLight intensity={1.4} />
            <directionalLight position={[-4, 8, -5]} intensity={1.8} />
            <Bounds fit clip observe margin={1.15}>
              <Boxes geo={geo} palette={palette} hidden={hidden} />
            </Bounds>
            <OrbitControls makeDefault enableDamping />
          </Canvas>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {bones.map((b) => (
          <button key={b} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(b)) n.delete(b); else n.add(b); return n; })}
            className={`rounded-full border px-3 py-1 text-xs ${hidden.has(b) ? "border-line text-muted line-through" : "border-accent/60"}`}>{b}</button>
        ))}
      </div>
    </div>
  );
}
