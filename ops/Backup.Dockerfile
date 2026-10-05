FROM python:3.12-slim-trixie
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
COPY requirements.lock ./
COPY ops/ ./ops/
RUN pip install --no-cache-dir -r requirements.lock -r ops/requirements-backup.txt && useradd --create-home backupuser
USER backupuser
CMD ["python", "ops/backup.py", "daily"]
