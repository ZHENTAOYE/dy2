#!/bin/sh
# Contact sheet of rendered stills: scripts/sheet.sh out.jpg cols files...
out=$1; cols=$2; shift 2
n=$#
rows=$(( (n + cols - 1) / cols ))
inputs=""
for f in "$@"; do inputs="$inputs -i $f"; done
ffmpeg -loglevel error -y $inputs -filter_complex "$(i=0; for f in "$@"; do printf "[%d:v]scale=800:-1,drawtext=text='%s':x=8:y=8:fontcolor=yellow:fontsize=22[v%d];" $i "$(basename $f .jpg)" $i; i=$((i+1)); done; i=0; for f in "$@"; do printf "[v%d]" $i; i=$((i+1)); done; printf "xstack=inputs=%d:layout=" $n; i=0; for f in "$@"; do c=$((i % cols)); r=$((i / cols)); [ $i -gt 0 ] && printf "|"; printf "%d_%d" $((c*800)) $((r*450)); i=$((i+1)); done; [ $n -eq 1 ] && true)" $out 2>&1
