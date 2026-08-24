@echo off
cd /d %~dp0
if not exist mcp-diagnostic.log (
  echo No existe mcp-diagnostic.log todavia.
  pause
  exit /b 0
)
notepad mcp-diagnostic.log
