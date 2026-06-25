#!/usr/bin/env bash
# Build standalone binaries for Windows + Linux from one machine using Bun's
# cross-compiler. Output: dist/radar-windows.exe and dist/radar-linux.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' package.json | head -1 | tr -d '"')}"
echo "Building RadarPL v$VERSION"

# Stamp the version into the binary so the self-updater knows what it is.
sed -i.bak "s/export const VERSION = \".*\"/export const VERSION = \"$VERSION\"/" agent/version.ts && rm -f agent/version.ts.bak

mkdir -p dist
ENTRY="agent/cli.ts"

# Optional deps reachable only via guarded dynamic imports (web/Postgres path) —
# never in the CLI graph. Mark external so the binary build can't fail on them.
EXT="--external @prisma/client --external ioredis --external next --external react --external react-dom --external @radar/core --external zod"

bun build "$ENTRY" --compile --minify $EXT --target=bun-linux-x64   --outfile dist/radar-linux
bun build "$ENTRY" --compile --minify $EXT --target=bun-windows-x64 --outfile dist/radar-windows.exe

echo "Done:"
ls -lh dist/radar-linux dist/radar-windows.exe
