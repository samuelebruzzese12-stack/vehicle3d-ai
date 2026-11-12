"""
Vehicle3D AI – worker di generazione 3D open source (self-hosted, gratuito).

Modelli:
  triposr  – TripoSR (MIT). Funziona anche su CPU (minuti) o GPU >= 6 GB (secondi).
  trellis  – TRELLIS (MIT), solo se installato e con GPU NVIDIA >= 16 GB.

POST /generate?model=triposr&resolution=256   corpo: immagine JPEG/PNG   header: Authorization: Bearer <AI_WORKER_TOKEN>
  → 200 GLB (vertex color), header X-Vehicle3D-Report con i dettagli
GET /health → modelli disponibili e dispositivo
"""
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ.get("AI_WORKER_TOKEN", "")
TRIPOSR_DIR = os.environ.get("TRIPOSR_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "TripoSR"))
MAX_BYTES = 15 * 1024 * 1024
_lock = threading.Lock()  # un job alla volta: la memoria è il limite
_models = {}


def device():
    import torch
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def load_triposr():
    if "triposr" in _models:
        return _models["triposr"]
    sys.path.insert(0, TRIPOSR_DIR)
    import marching_shim  # noqa: F401  sostituisce torchmcubes se non compilato
    from tsr.system import TSR
    m = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
    m.renderer.set_chunk_size(8192)
    m.to(device())
    _models["triposr"] = m
    return m


def run_triposr(image_bytes, resolution=256):
    import numpy as np
    import rembg
    import torch
    from PIL import Image
    from tsr.utils import remove_background, resize_foreground

    t0 = time.time()
    model = load_triposr()
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    session = rembg.new_session()
    img = remove_background(img, session)
    img = resize_foreground(img, 0.85)
    arr = np.array(img).astype(np.float32) / 255.0
    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
    img = Image.fromarray((arr * 255.0).astype(np.uint8))
    t1 = time.time()
    with torch.no_grad():
        codes = model([img], device=device())
    meshes = model.extract_mesh(codes, True, resolution=resolution)
    mesh = meshes[0]
    mesh.fix_normals()  # orientamento coerente delle facce (lo shim scikit-image può invertirlo)
    out = io.BytesIO()
    mesh.export(out, file_type="glb")
    return out.getvalue(), {
        "model": "TripoSR", "license": "MIT", "device": device(), "resolution": resolution,
        "vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)),
        "seconds_background": round(t1 - t0, 1), "seconds_total": round(time.time() - t0, 1),
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "device": device(), "models": ["triposr"]})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/generate":
            return self._json(404, {"error": "not found"})
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._json(401, {"error": "unauthorized"})
        n = int(self.headers.get("Content-Length", "0"))
        if n <= 0 or n > MAX_BYTES:
            return self._json(413, {"error": "immagine mancante o troppo grande"})
        data = self.rfile.read(n)
        q = parse_qs(url.query)
        model = q.get("model", ["triposr"])[0]
        if model != "triposr":
            return self._json(400, {"error": f"modello non installato su questo worker: {model}"})
        res = max(128, min(int(q.get("resolution", ["256"])[0]), 384))
        if not _lock.acquire(timeout=1):
            return self._json(429, {"error": "worker occupato, riprova"})
        try:
            glb, report = run_triposr(data, res)
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": str(e)})
        finally:
            _lock.release()
        self.send_response(200)
        self.send_header("Content-Type", "model/gltf-binary")
        self.send_header("Content-Length", str(len(glb)))
        self.send_header("X-Vehicle3D-Report", json.dumps(report))
        self.end_headers()
        self.wfile.write(glb)


if __name__ == "__main__":
    if len(sys.argv) == 3:  # uso da riga di comando: worker.py input.jpg output.glb
        with open(sys.argv[1], "rb") as f:
            glb, rep = run_triposr(f.read(), int(os.environ.get("RESOLUTION", "256")))
        with open(sys.argv[2], "wb") as f:
            f.write(glb)
        print(json.dumps(rep))
        sys.exit(0)
    port = int(os.environ.get("PORT", "8081"))
    print(f"AI worker su :{port} (dispositivo {device()})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
