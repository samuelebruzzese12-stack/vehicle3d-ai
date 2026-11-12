# Worker Blender opzionale per Vehicle3D AI (non su Vercel).
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libxrender1 libxi6 libxkbcommon0 libsm6 libgl1 libxxf86vm1 libxfixes3 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir bpy==5.3.0
WORKDIR /app
COPY process_vehicle.py worker.py ./
ENV PORT=8080
EXPOSE 8080
CMD ["python", "worker.py"]
