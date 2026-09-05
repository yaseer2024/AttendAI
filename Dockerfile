# Build Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install --include=dev
COPY frontend/ ./
RUN npm install -g vite
RUN vite build

# Build Backend & Combine
FROM python:3.10-slim
WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend-builder /build/dist /app/frontend/dist

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]