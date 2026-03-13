#!/bin/bash
cd "$(dirname "$0")"
docker compose up -d
echo "✓ Speakr is running at http://localhost:8899"
