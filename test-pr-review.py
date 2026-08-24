#!/usr/bin/env python3
import subprocess
import json
import urllib.request

def get_git_diff():
    # Obtener el diff del commit de SSL de hubegento
    cmd = ["git", "-C", "/home/pedro/hubegento-project", "show", "eee1cbf", "--stat", "--patch", "--", "apps/", "packages/"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    # Limitar a ~4000 caracteres de diff para la prueba
    return res.stdout[:4000]

diff_content = get_git_diff()

prompt = f"""Actúa como un Senior Staff Software Engineer y Revisor de PRs especializado en TypeScript, Node.js y Seguridad.
Analiza el siguiente git diff del proyecto Hubegento (feature de SSL y Dominios) y proporciona:
1. Resumen del cambio
2. Calidad de código y Clean Code
3. Posibles bugs, casos borde o riesgos de seguridad
4. Recomendaciones concretas de mejora

DIFF:
```diff
{diff_content}
```
"""

print("🚀 Enviando Git Diff de Hubegento a Kimi-K3 a través de nuestro Proxy OpenAI...")

req_body = {
    "model": "fireworks-kimi-k3",
    "messages": [
        {"role": "user", "content": prompt}
    ]
}

req = urllib.request.Request(
    "http://127.0.0.1:8318/v1/chat/completions",
    data=json.dumps(req_body).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    print("\n" + "="*80)
    print("📋 REPORTE DE CODE REVIEW GENERADO POR KIMI-K3:")
    print("="*80)
    print(content)
    print("="*80)
