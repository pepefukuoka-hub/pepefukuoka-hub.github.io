#!/bin/bash
# 公開した住所の、ファイルがあるかを確かめる。使い方: tools/check-urls.sh [live]
#   live を付けると、実際の公開ページも、取得して確かめる
cd "$(dirname "$0")/.." || exit 1
BASE=https://pepefukuoka-hub.github.io
PATHS="music/ music/stem-ai/ music/video-audio/ music/cut/ stem-ai/ video-audio/ private/ work/ music/qr.svg"
bad=0
for p in $PATHS; do
  f="$p"; [[ "$p" == */ ]] && f="${p}index.html"
  [ -f "$f" ] || { echo "ない: $f"; bad=1; }
  if [ "$1" = live ]; then
    c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$p"); [ "$c" = 200 ] || { echo "開けない($c): $BASE/$p"; bad=1; }
  fi
done
[ $bad = 0 ] && echo "住所は、すべて無事です" || { echo "住所が壊れています。push しないでください"; exit 1; }
