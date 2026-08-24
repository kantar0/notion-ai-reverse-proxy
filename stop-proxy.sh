#!/usr/bin/env bash
PID=$(pgrep -f "notion_openai_server.py")
if [ -n "$PID" ]; then
  kill $PID
  echo "🛑 Servidor Notion AI detenido (PID: $PID)"
else
  echo "ℹ️ No hay ningún servidor Notion AI corriendo."
fi
