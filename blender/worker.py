"""
Worker HTTP Blender per Vehicle3D AI (da eseguire fuori da Vercel: Docker, Render, Fly.io, Cloud Run...).

POST /process?target_tris=300000   corpo: GLB (non compresso)   header: Authorization: Bearer <BLENDER_WORKER_TOKEN>
→ 200 GLB ottimizzato, header X-Vehicle3D-Report con il report JSON.
GET /health → {"ok": true, "blender": "..."}
"""
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ.get("BLENDER_WORKER_TOKEN", "")
MAX_BYTES = int(os.environ.get("MAX_BYTES", str(200 * 1024 * 1024)))
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "process_vehicle.py")
BLENDER = os.environ.get("BLENDER_BIN")  # se impostato usa il binario Blender, altrimenti il modulo bpy di questo Python


def run(inp, out, target, extra=()):
    args = [inp, out, "--target-tris", str(target), *extra]
    cmd = [BLENDER, "-b", "--factory-startup", "-P", SCRIPT, "--", *args] if BLENDER else [sys.executable, SCRIPT, *args]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    lines = [l for l in p.stdout.strip().splitlines() if l.startswith("{")]
    if p.returncode != 0 or not lines:
        raise RuntimeError((p.stderr or p.stdout)[-1500:])
    return json.loads(lines[-1])


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
            import bpy  # noqa: F401  verifica che Blender sia disponibile
            return self._json(200, {"ok": True, "blender": bpy.app.version_string if not BLENDER else BLENDER})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in ("/process", "/convert"):
            return self._json(404, {"error": "not found"})
        if not TOKEN or self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self._json(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BYTES:
            return self._json(413, {"error": "file mancante o troppo grande"})
        data = self.rfile.read(length)
        q = parse_qs(url.query)
        fmt = q.get("format", ["glb"])[0]
        if fmt not in ("glb", "fbx", "blend", "obj", "stl"):
            return self._json(400, {"error": "formato non supportato"})
        if fmt == "glb" and data[:4] != b"glTF":
            return self._json(422, {"error": "non è un GLB"})
        target = max(1000, min(int(q.get("target_tris", ["300000"])[0]), 2_000_000))
        extra = []
        if url.path == "/convert":
            extra.append("--convert-only")
        if q.get("separate", ["0"])[0] == "1":
            extra.append("--separate-loose")
        bake = int(q.get("bake", ["0"])[0])
        if bake in (512, 1024, 2048, 4096):
            extra += ["--bake", str(bake)]
        with tempfile.TemporaryDirectory() as d:
            inp, out = os.path.join(d, f"in.{fmt}"), os.path.join(d, "out.glb")
            with open(inp, "wb") as f:
                f.write(data)
            try:
                report = run(inp, out, target, extra)
            except Exception as e:  # noqa: BLE001
                return self._json(500, {"error": str(e)})
            with open(out, "rb") as f:
                glb = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "model/gltf-binary")
        self.send_header("Content-Length", str(len(glb)))
        self.send_header("X-Vehicle3D-Report", json.dumps(report))
        self.end_headers()
        self.wfile.write(glb)

    def log_message(self, fmt, *args):
        sys.stderr.write("[worker] " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"Blender worker in ascolto su :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
