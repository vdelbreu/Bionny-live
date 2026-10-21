#!/usr/bin/env bash
# Scénarios dans un vrai navigateur : chacun dans un Chrome sans fenêtre, avec un profil jetable supprimé ensuite.
# Le site doit être servi en local : python -m http.server 8765 --bind 127.0.0.1 (à la racine du projet).
# Usage : bash test/navigateur/lancer.sh [parcours connexion ouverture sante sommeil]   (CAPTURES=dossier pour des images)
cd "$(dirname "$0")" || exit 1
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
SCENARIOS="${*:-parcours connexion ouverture sante sommeil}"
curl -s -o /dev/null http://127.0.0.1:8765/index.html || { echo "Site non servi sur le port 8765"; exit 1; }
echec=0
for s in $SCENARIOS; do
  PROFIL="$(mktemp -d)/viawrist-test-$s"
  mkdir -p "$PROFIL"
  "$CHROME" --headless=new --remote-debugging-port=9333 --user-data-dir="$(cygpath -w "$PROFIL" 2>/dev/null || echo "$PROFIL")" \
    --no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 &
  echo "=== $s"
  node "$s.mjs" 9333 || echec=1
  # n'arrête que ce Chrome-là : les processus qui utilisent ce profil jetable
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*viawrist-test-$s*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 \
    || kill $! 2>/dev/null
  for i in 1 2 3 4 5; do rm -rf "$(dirname "$PROFIL")" 2>/dev/null && break; sleep 1; done
done
exit $echec
