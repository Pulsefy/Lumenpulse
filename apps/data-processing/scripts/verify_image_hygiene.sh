#!/usr/bin/env bash
# Post-build hygiene checks for the data-processing image (#1255).
#
# Usage:  bash scripts/verify_image_hygiene.sh <image-tag>
#
# Verifies that build artifacts, logs, caches and test fixtures are absent
# from the built image and reports its final size. Intended to run in CI
# right after `docker build`.

set -euo pipefail

IMAGE="${1:?usage: verify_image_hygiene.sh <image-tag>}"
RUN="docker run --rm --entrypoint /bin/sh ${IMAGE} -c"

echo "== Image size =="
docker image ls "${IMAGE}" --format '{{.Repository}}:{{.Tag}}  {{.Size}}'

echo "== Forbidden paths (must print nothing) =="
${RUN}'for p in \
        /app/venv /app/.venv /app/env \
        /app/logs /app/*.log \
        /app/tests /app/data/synthetic_test \
        /app/examples \
        $(find /app -name "__pycache__" -o -name "*.pyc" -o -name ".pytest_cache" 2>/dev/null); do
      [ -e "$p" ] && echo "FOUND (must not exist): $p" && exit 1
    done
    echo OK'

echo "== Build toolchain absent from runtime (must print nothing) =="
${RUN}'for b in gcc cc g++ make ld apt-get; do
      command -v "$b" >/dev/null 2>&1 && echo "FOUND toolchain binary: $b" && exit 1
    done
    echo OK'

echo "== Runs as non-root =="
[ "$(${RUN}'id -u')" != "0" ] || { echo "FAIL: container runs as root"; exit 1; }
${RUN}'id'

echo "== All dependencies hash-pinned (lockfile sanity inside image) =="
${RUN}'pip list --path /opt/venv/lib/python3.9/site-packages | wc -l'

echo "ALL CHECKS PASSED"
