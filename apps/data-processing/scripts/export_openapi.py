import json
import os
import sys

# Add parent directory to path to import from src
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.api.server import app

def export_schema(output_path):
    schema = app.openapi()
    with open(output_path, "w") as f:
        json.dump(schema, f, indent=2)
    print(f"OpenAPI schema exported to {output_path}")

if __name__ == "__main__":
    output_file = sys.argv[1] if len(sys.argv) > 1 else "openapi.json"
    export_schema(output_file)
