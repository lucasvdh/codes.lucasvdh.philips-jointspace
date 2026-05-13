#!/usr/bin/env bash
#
# Auth-aware Philips Jointspace diagnostic, using curl's built-in digest.
# A second opinion on whether our Node-based digest implementation is fine
# or whether the TV is responding differently to a different client.
#
# Usage:
#   scripts/diagnose-curl.sh <tv-ip> [credentials.json]
#
# credentials.json (defaults to ./credentials.json) must contain at least:
#   { "user": "<digest user>", "pass": "<digest password>" }
#
# Probes each endpoint on both HTTP/1925 and HTTPS/1926, prints a table of
# (transport, endpoint, http status, body summary). No npm install needed.

set -uo pipefail

IP="${1:-}"
CREDS_FILE="${2:-./credentials.json}"

if [[ -z "${IP}" ]]; then
  echo "Usage: $0 <tv-ip> [credentials.json]" >&2
  exit 1
fi

if [[ ! -r "${CREDS_FILE}" ]]; then
  echo "Cannot read ${CREDS_FILE}" >&2
  exit 1
fi

# Extract user/pass from JSON without depending on jq.
USER_NAME=$(grep -oE '"(user|username)"[[:space:]]*:[[:space:]]*"[^"]+"' "${CREDS_FILE}" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
PASSWORD=$(grep -oE '"(pass|password)"[[:space:]]*:[[:space:]]*"[^"]+"' "${CREDS_FILE}" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')

if [[ -z "${USER_NAME}" || -z "${PASSWORD}" ]]; then
  echo "Could not extract user/pass from ${CREDS_FILE}" >&2
  exit 1
fi

# Each line: "<auth?>|<METHOD>|<path-after-api-version>"
ENDPOINTS=(
  "no|GET|system|raw"
  "yes|GET|powerstate"
  "yes|GET|audio/volume"
  "yes|GET|ambilight/currentconfiguration"
  "yes|GET|HueLamp/power"
  "yes|GET|screenstate"
  "yes|GET|applications"
  "yes|GET|sources"
  "yes|GET|channeldb/tv"
  "yes|GET|activities/current"
)

printf "# Philips Jointspace curl-digest diagnostic\n\n"
printf -- "- Target IP: %s\n" "${IP}"
printf -- "- Digest user: %s\n" "${USER_NAME}"
printf -- "- Generated: %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf -- "- curl: %s\n\n" "$(curl --version | head -1)"

printf "## Probes\n\n"
printf "| Endpoint | HTTP/1925 | HTTPS/1926 |\n"
printf "|---|---|---|\n"

run_probe() {
  local url="$1"
  local method="$2"
  local needs_auth="$3"
  local extra_opts=()

  if [[ "${needs_auth}" == "yes" ]]; then
    extra_opts+=(--digest --user "${USER_NAME}:${PASSWORD}")
  fi

  # -k: skip cert verification (TV uses self-signed)
  # -s: silent
  # -o: discard body to /tmp file we can inspect
  # -w: print status + size + time
  local body_file
  body_file="$(mktemp)"
  local out
  out=$(curl -k -s -o "${body_file}" -w "%{http_code}|%{size_download}|%{time_total}" \
        --max-time 8 \
        -X "${method}" \
        "${extra_opts[@]}" \
        "${url}" 2>/dev/null || echo "curl_error|0|0")

  local code="${out%%|*}"
  local rest="${out#*|}"
  local size="${rest%%|*}"
  local time="${rest##*|}"

  local preview=""
  if [[ -s "${body_file}" ]]; then
    preview=$(head -c 80 "${body_file}" | tr -d '\n' | tr '|' ' ')
    if [[ $(wc -c < "${body_file}") -gt 80 ]]; then
      preview="${preview}…"
    fi
  fi
  rm -f "${body_file}"

  if [[ "${code}" == "000" || "${code}" == "curl_error" ]]; then
    printf "❌ connect-fail (%ss)" "${time}"
  elif [[ "${code}" =~ ^2 ]]; then
    printf "✅ %s (%ss) %s" "${code}" "${time}" "${preview}"
  else
    printf "⚠️ %s (%ss) %s" "${code}" "${time}" "${preview}"
  fi
}

for entry in "${ENDPOINTS[@]}"; do
  IFS='|' read -r auth method path raw <<<"${entry}"

  if [[ "${raw:-}" == "raw" ]]; then
    http_path="${path}"
    https_path="${path}"
  else
    http_path="6/${path}"
    https_path="6/${path}"
  fi

  http_url="http://${IP}:1925/${http_path}"
  https_url="https://${IP}:1926/${https_path}"

  printf "| \`%s\` | " "${method} ${path}"
  run_probe "${http_url}" "${method}" "${auth}"
  printf " | "
  run_probe "${https_url}" "${method}" "${auth}"
  printf " |\n"
done
