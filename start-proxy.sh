#!/usr/bin/env bash
PID=$(pgrep -f "notion_openai_server.py")
if [ -n "$PID" ]; then
  echo "⚠️ El servidor ya está corriendo (PID: $PID)"
else
  nohup python3 /home/pedro/agenciakiwi-project/notion_openai_server.py > /home/pedro/agenciakiwi-project/notion_proxy.log 2>&1 &
  echo "🚀 Notion AI Proxy Server iniciado en background (PID: $!)"
  echo "📡 Endpoint OpenAI: http://127.0.0.1:8318/v1"
fi
