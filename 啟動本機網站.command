#!/bin/zsh
cd "$(dirname "$0")"
exec .venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8765
