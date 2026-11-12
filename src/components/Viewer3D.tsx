"use client";
import { Canvas, useThree } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";

function Model({ url, hidden, onParts }: { url: string; hidden: Set<string>; onParts: (p: string[]) => void }) {
  const { scene } = useGLTF(url);
  const parts = useMemo(() => {
    const root = scene.getObjectByName("Veicolo") ?? scene;
    return root.children.map((c) => c.name).filter(Boolean);
  }, [scene]);
  useEffect(() => onParts(parts), [parts, onParts]);
  useEffect(() => {
    const root = scene.getObjectByName("Veicolo") ?? scene;
    root.children.forEach((c) => (c.visible = !hidden.has(c.name)));
  }, [scene, hidden]);
  return <primitive object={scene} />;
}

function Renderer() {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
  }, [gl]);
  return null;
}

export default function Viewer3D({ url }: { url: string }) {
  const [parts, setParts] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  return (
    <div className="space-y-2">
      <div className="h-80 overflow-hidden rounded-2xl border border-line bg-[radial-gradient(circle_at_50%_30%,#24305a,#0b1020)] sm:h-[28rem]">
        <Canvas camera={{ position: [5, 3, 6], fov: 40 }} dpr={[1, 2]}>
          <Renderer />
          <hemisphereLight args={["#ffffff", "#334155", 1.2]} />
          <directionalLight position={[5, 8, 5]} intensity={2.2} />
          <directionalLight position={[-6, 4, -4]} intensity={0.8} />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.15}>
              <Model url={url} hidden={hidden} onParts={setParts} />
            </Bounds>
          </Suspense>
          <gridHelper args={[12, 24, "#334155", "#1e293b"]} />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      </div>
      {parts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {parts.map((p) => (
            <button key={p} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(p)) n.delete(p); else n.add(p); return n; })}
              className={`rounded-full border px-3 py-1 text-xs ${hidden.has(p) ? "border-line text-muted line-through" : "border-accent/60 text-text"}`}>
              {p.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Trascina per ruotare, pizzica per lo zoom. Tocca un componente per nasconderlo.</p>
    </div>
  );
}
