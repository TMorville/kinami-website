#!/bin/zsh
# Key the seedance brush video to transparent sienna ink, then build:
#   paint.webp   animated, plays once: the brush stroke painting the enso
#   ink.webp     static final frame, identical to the animation's last frame
set -e
D=/private/tmp/claude-501/-Users-tomo-kinami-website/085538eb-5db4-464c-9f64-9a13e6cdf1dd/scratchpad/brush
SIZE=800
FPS=20
END=2.6          # the paint completes at ~2.0s; keep a short settle
LEVEL="44%,86%"  # luma of stroke -> opaque, luma of paper -> transparent
SIENNA='#A0522D'

rm -rf $D/raw $D/keyed; mkdir -p $D/raw $D/keyed
ffmpeg -v error -y -i $D/enso-a.mp4 -t $END -vf "fps=$FPS,scale=${SIZE}:${SIZE}:flags=lanczos" $D/raw/f%03d.png

for f in $D/raw/f*.png; do
  n=${f:t}
  magick $f -colorspace gray -level $LEVEL -negate $D/keyed/a-$n
  magick -size ${SIZE}x${SIZE} xc:"$SIENNA" $D/keyed/a-$n -alpha off -compose CopyOpacity -composite $D/keyed/k-$n
done

# final frame, taken from the END of the full video so it matches what the animation lands on
ffmpeg -v error -y -sseof -0.05 -i $D/enso-a.mp4 -frames:v 1 -vf "scale=${SIZE}:${SIZE}:flags=lanczos" $D/raw/last.png
magick $D/raw/last.png -colorspace gray -level $LEVEL -negate $D/keyed/a-last.png
magick -size ${SIZE}x${SIZE} xc:"$SIENNA" $D/keyed/a-last.png -alpha off -compose CopyOpacity -composite $D/keyed/k-last.png

# animated webp, play once; hold the last frame by appending it with a long delay
magick -delay 5 -loop 1 $D/keyed/k-f*.png -delay 1000 $D/keyed/k-last.png -quality 82 -define webp:alpha-quality=85 $D/paint.webp
magick $D/keyed/k-last.png -quality 88 -define webp:alpha-quality=90 $D/ink.webp

echo "frames: $(ls $D/keyed/k-f*.png | wc -l)"
ls -la $D/paint.webp $D/ink.webp
