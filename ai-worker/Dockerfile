# Worker AI open source (TripoSR, MIT). Funziona su CPU; con GPU NVIDIA usare un'immagine CUDA e torch con CUDA.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir omegaconf einops "transformers>=4.40" trimesh huggingface-hub scikit-image "rembg[cpu]" pillow
WORKDIR /app
# codice ufficiale TripoSR (MIT) a una revisione fissata
RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git /app/TripoSR
COPY worker.py marching_shim.py ./
ENV TRIPOSR_DIR=/app/TripoSR PYTHONPATH=/app/TripoSR:/app PORT=8081
EXPOSE 8081
CMD ["python", "worker.py"]
