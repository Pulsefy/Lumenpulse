import json
import os
import sys

# Add parent directory to path to import from src
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.api.server import app

def test_openapi_document_is_up_to_date():
    openapi_path = os.path.join(os.path.dirname(__file__), "..", "openapi.json")
    
    # Generate the current schema
    current_schema = app.openapi()
    
    # Check if file exists
    assert os.path.exists(openapi_path), "openapi.json is missing. Please run export_openapi.py"
    
    # Load committed schema
    with open(openapi_path, "r") as f:
        committed_schema = json.load(f)
        
    assert current_schema == committed_schema, "openapi.json is stale relative to the code. Please regenerate it."
