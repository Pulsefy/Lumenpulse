# syntax=docker/dockerfile:1

###############################################################################
# Stage 1 — builder
# Installs dependencies and downloads model weights. All build toolchains
# (gcc, build-essential) live ONLY in this stage and never reach the runtime.
###############################################################################
FROM python:3.9-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/opt/hf

# Build toolchain: required only to compile any source distribution during
# dependency installation. Discarded with this stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# Isolated venv so the runtime image can copy a single self-contained tree.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.lock .

# Hash-checking mode: every package, including all transitive dependencies,
# must match the sha256 pinned in requirements.lock or the build fails.
# torch==2.7.1+cpu resolves from the PyTorch CPU index (CUDA-free wheels).
RUN pip install --require-hashes -r requirements.lock \
        --index-url https://pypi.org/simple \
        --extra-index-url https://download.pytorch.org/whl/cpu

# Bake FinBERT weights into the image so containers can run without Hub
# access at runtime. Done here so the runtime stage stays tool-free.
RUN python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; m='ProsusAI/finbert'; AutoTokenizer.from_pretrained(m); AutoModelForSequenceClassification.from_pretrained(m)"

###############################################################################
# Stage 2 — runtime
# Slim base image: no compilers, no build tooling, no pip caches.
# Runs as an unprivileged user (uid/gid 10001).
###############################################################################
FROM python:3.9-slim

LABEL org.opencontainers.image.title="lumenpulse-data-processing" \
      org.opencontainers.image.description="Lumenpulse data-processing service (slim, hash-pinned)" \
      org.opencontainers.image.source="https://github.com/Pulsefy/Lumenpulse"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface/hub \
    PATH="/opt/venv/bin:$PATH"

# libgomp1 is the only runtime library needed by scikit-learn's native wheels.
# Everything else ships as self-contained manylinux wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser

# Self-contained virtualenv built in the builder stage (same base image).
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY . .

# Model weights baked in the builder stage (no Hub access required at runtime).
COPY --from=builder /opt/hf /app/.cache/huggingface

# Application code stays root-owned (read-only for the service); only the
# directories the process writes to at runtime are owned by appuser.
RUN mkdir -p /app/logs /app/models /app/data /app/.cache/huggingface \
    && chown -R appuser:appuser /app/logs /app/models /app/data /app/.cache/huggingface

USER appuser

CMD ["python", "src/main.py"]
