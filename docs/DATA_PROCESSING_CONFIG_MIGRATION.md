# Data-Processing Service Configuration Migration Guide

## Overview
As of Issue #1197, backend configuration for the Python data-processing service has been unified across the entire codebase.

Previously, different modules addressed the service using disjointed environment variables and inconsistent defaults:
- `PYTHON_API_URL` (defaulted to `http://localhost:8000`)
- `PYTHON_SERVICE_URL` (optional, fell back to `PYTHON_API_URL`)
- `DATA_PROCESSING_URL` (defaulted to `http://localhost:8001`)
- `DATA_PROCESSING_API_KEY` (unvalidated raw env read)

This caused silent integration failures and configuration drift in environments where different ports or hostnames were configured.

---

## Canonical Configuration Variables

The backend now uses a single, validated set of variables:

| Variable | Description | Development Default | Staging / Production |
| :--- | :--- | :--- | :--- |
| `PYTHON_API_URL` | Base URL for the Python data-processing FastAPI service | `http://localhost:8000` | **Required** (Startup will fail if missing) |
| `PYTHON_API_KEY` | Optional API key for authenticating requests via `X-API-Key` | `None` / `local-dev-key` | Optional / As configured |

### Default Port Confirmation
The default port is confirmed as **`8000`**, matching the FastAPI server definition in `apps/data-processing/src/api/server.py` (`uvicorn.run(..., port=8000)`).

---

## Removed Variables (Migration Actions)

If your existing staging or production deployment configurations use any of the removed variables below, please update them:

| Removed Variable | Replacement | Action |
| :--- | :--- | :--- |
| `DATA_PROCESSING_URL` | `PYTHON_API_URL` | Rename in environment / deployment manifests / secrets managers. |
| `PYTHON_SERVICE_URL` | `PYTHON_API_URL` | Rename in environment / deployment manifests / secrets managers. |
| `DATA_PROCESSING_API_KEY` | `PYTHON_API_KEY` | Rename in environment / deployment manifests / secrets managers. |

---

## Fail-Fast Boot Behavior

In non-development environments (`NODE_ENV=production` or `NODE_ENV=staging`):
- If `PYTHON_API_URL` is omitted or empty, backend startup will immediately fail with the error:
  `Configuration validation failed. Fix the following variables: PYTHON_API_URL: PYTHON_API_URL must be set in non-development environments.`
- In local development (`NODE_ENV=development`) or test environments (`NODE_ENV=test`), `PYTHON_API_URL` automatically defaults to `http://localhost:8000`.
