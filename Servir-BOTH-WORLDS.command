#!/bin/bash
# Sirve app/dist en el primer puerto libre desde 4173 y abre el navegador. Requiere node.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Necesita node (https://nodejs.org). Alternativa: doble clic en BOTH-WORLDS.html"; read -n1 -r -p "Enter para cerrar"; exit 1; fi
node serve.mjs
