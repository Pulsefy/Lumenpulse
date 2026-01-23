# LumenPulse Data Processing Service

This service handles compute-heavy tasks such as sentiment analysis and market trend prediction for the StarkPulse project.

## Project Structure

- `src/`: Core logic and service implementation.
- `tests/`: Unit and integration tests.
- `scripts/`: Helper scripts for data management and development.

## Setup Instructions

### 1. Prerequisites

- Python 3.9 or higher

### 2. Create and Activate Virtual Environment

**On Windows:**
```powershell
# Create virtual environment (using Python Launcher)
py -m venv venv

# Activate virtual environment
.\venv\Scripts\activate
```

**On macOS/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**On Windows:**
```bash
python -m venv venv
venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Environment Variables

Create a `.env` file in the root of `apps/data-processing` and add any necessary configuration.

### 5. Running the Service

```bash
python src/main.py
```