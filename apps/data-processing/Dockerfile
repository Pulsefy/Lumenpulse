FROM python:3.9-slim

WORKDIR /app

ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface/hub

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bake FinBERT weights into the image so containers can run without Hub access at runtime.
RUN mkdir -p /app/.cache/huggingface \
    && python -c "from transformers import AutoModelForSequenceClassification, AutoTokenizer; m='ProsusAI/finbert'; AutoTokenizer.from_pretrained(m); AutoModelForSequenceClassification.from_pretrained(m)"

CMD ["python", "src/main.py"]
