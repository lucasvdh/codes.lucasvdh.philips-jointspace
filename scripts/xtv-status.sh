#!/usr/bin/env bash
# xtv-status.sh — check Philips jointspace daemon (org.droidtv.xtv)
#
# Gebruik:  ./xtv-status.sh
#           TV_IP=192.168.1.130 ./xtv-status.sh
#
# Exit codes:
#   0  daemon reageert op zowel HTTP (1925) als HTTPS (1926)
#   1  ADB device niet bereikbaar
#   2  proces draait niet
#   3  HTTP 1925 hangt of geeft non-2xx
#   4  HTTPS 1926 hangt of geeft non-2xx

set -u

# --- TV IP: env > eerste ADB device ---
if [[ -z "${TV_IP:-}" ]]; then
  TV_IP=$(adb devices | awk '/\t(device|emulator)/{print $1}' | head -1 | cut -d: -f1)
fi
if [[ -z "$TV_IP" ]]; then
  echo "geen ADB device gevonden — connect eerst met 'adb connect <ip>:5555'" >&2
  exit 1
fi

bold()   { printf '\033[1m%s\033[0m' "$*"; }
green()  { printf '\033[32m%s\033[0m' "$*"; }
red()    { printf '\033[31m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }

echo "$(bold "TV") $TV_IP"
echo

# --- 1. Proces ---
PS_LINE=$(adb -s "${TV_IP}:5555" shell "ps -A 2>/dev/null | grep org.droidtv.xtv" 2>/dev/null | tr -d '\r')
if [[ -z "$PS_LINE" ]]; then
  echo "$(red "✗") xtv proces draait niet"
  exit 2
fi
XTV_PID=$(echo "$PS_LINE" | awk '{print $2}')
XTV_RSS=$(echo "$PS_LINE" | awk '{printf "%.1f MB", $5/1024}')
XTV_THREADS=$(adb -s "${TV_IP}:5555" shell "grep ^Threads: /proc/$XTV_PID/status 2>/dev/null" | tr -d '\r' | awk '{print $2}')
echo "$(green "✓") xtv proces  PID=$XTV_PID  RSS=$XTV_RSS  threads=$XTV_THREADS"

# --- 2. HTTP 1925 ---
HTTP_OUT=$(curl -s -m 5 -o /dev/null -w '%{http_code} %{time_total}' "http://$TV_IP:1925/6/system" 2>/dev/null || echo "000 timeout")
HTTP_CODE=$(echo "$HTTP_OUT" | awk '{print $1}')
HTTP_TIME=$(echo "$HTTP_OUT" | awk '{print $2}')
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "$(green "✓") HTTP  1925  ${HTTP_CODE}  ${HTTP_TIME}s"
  HTTP_OK=1
else
  echo "$(red "✗") HTTP  1925  ${HTTP_CODE}  ${HTTP_TIME}s"
  HTTP_OK=0
fi

# --- 3. HTTPS 1926 ---
HTTPS_OUT=$(curl -sk -m 8 -o /dev/null -w '%{http_code} %{time_total}' "https://$TV_IP:1926/6/system" 2>/dev/null || echo "000 timeout")
HTTPS_CODE=$(echo "$HTTPS_OUT" | awk '{print $1}')
HTTPS_TIME=$(echo "$HTTPS_OUT" | awk '{print $2}')
if [[ "$HTTPS_CODE" == "200" ]]; then
  echo "$(green "✓") HTTPS 1926  ${HTTPS_CODE}  ${HTTPS_TIME}s"
  HTTPS_OK=1
else
  echo "$(red "✗") HTTPS 1926  ${HTTPS_CODE}  ${HTTPS_TIME}s  $([ "$HTTPS_CODE" = "000" ] && echo "(hang/timeout)")"
  HTTPS_OK=0
fi

# --- 4. Socket-stats (FD/connection leak indicator) ---
TCP=$(adb -s "${TV_IP}:5555" shell "cat /proc/net/tcp6" 2>/dev/null | tr -d '\r')
# Port 1925 = 0x0785, 1926 = 0x0786
# Kolom 4 is status: 0A=LISTEN, 08=CLOSE_WAIT, 01=ESTABLISHED
LISTEN_QUEUE_1926=$(echo "$TCP" | awk '/:0786 /{ if ($4=="0A") { split($5,q,":"); print strtonum("0x" q[2]); exit } }')
CW_1926=$(echo "$TCP" | awk '/:0786 /{ if ($4=="08") c++ } END{ print c+0 }')
CW_1925=$(echo "$TCP" | awk '/:0785 /{ if ($4=="08") c++ } END{ print c+0 }')
EST_1926=$(echo "$TCP" | awk '/:0786 /{ if ($4=="01") c++ } END{ print c+0 }')

echo
echo "$(bold "Socket-stats")"
printf "  poort 1926  listen accept-queue : %s%s\n" "$LISTEN_QUEUE_1926" \
  "$([ "${LISTEN_QUEUE_1926:-0}" -gt 5 ] 2>/dev/null && yellow "  ⚠ pending accepts" || echo "")"
printf "  poort 1926  CLOSE_WAIT          : %s%s\n" "$CW_1926" \
  "$([ "$CW_1926" -gt 5 ] && yellow "  ⚠ FD leak verdacht" || echo "")"
printf "  poort 1926  ESTABLISHED         : %s\n" "$EST_1926"
printf "  poort 1925  CLOSE_WAIT          : %s\n" "$CW_1925"

# --- 5. Recente xtv log-errors (best-effort, kort) ---
echo
echo "$(bold "Recente xtv warnings/errors (laatste 5)")"
adb -s "${TV_IP}:5555" shell "logcat -d -t 200 2>/dev/null" \
  | grep -E " W |E " \
  | grep -E "\b${XTV_PID}\b|xtv" \
  | grep -vE "System.err.*restlet|InboundWay|OutboundWay|setIoState|ContextImpl" \
  | tail -5 \
  | sed 's/^/  /'

# --- Exit code ---
echo
if   [[ $HTTP_OK -eq 0 ]]; then exit 3
elif [[ $HTTPS_OK -eq 0 ]]; then exit 4
else exit 0
fi
