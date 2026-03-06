FROM python:3.11-slim

# Non-root user for security
RUN groupadd -g 1001 arma3 && \
    useradd -u 1001 -g arma3 -s /bin/bash -m arma3

WORKDIR /app

# Install dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Data directory for SQLite DB
RUN mkdir -p /app/data && chown -R arma3:arma3 /app

USER arma3

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
