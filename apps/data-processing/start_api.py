#!/usr/bin/env python3
"""
Start script for the Sentiment Analysis API
"""

import subprocess
import sys


def main():
    """Start the FastAPI server"""
    print("Starting Sentiment Analysis API...")
    print("API will be available at: http://localhost:8000")
    print("Endpoint: POST http://localhost:8000/analyze")
    print("Press Ctrl+C to stop\n")

    subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "src.api.server:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            "--reload",
        ]
    )


if __name__ == "__main__":
    main()
