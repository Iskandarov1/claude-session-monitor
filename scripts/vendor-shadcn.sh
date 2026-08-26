#!/usr/bin/env bash
# Copies shadcn/ui v4 primitives out of a local ui-main checkout into this app.
# Usage: ./scripts/vendor-shadcn.sh [path-to-ui-main]
set -euo pipefail

SRC="${1:-${SHADCN_SRC:-/Users/iskandarov/Downloads/ui-main}}"
REG="$SRC/apps/v4/registry/new-york-v4"
DEST_UI="src/renderer/src/components/ui"
DEST_LIB="src/renderer/src/lib"

[ -d "$REG/ui" ] || { echo "error: $REG/ui not found - pass the path to the ui-main checkout"; exit 1; }

COMPONENTS=(button input textarea dropdown-menu popover context-menu dialog command separator scroll-area tooltip kbd empty badge)

mkdir -p "$DEST_UI" "$DEST_LIB"
cp "$REG/lib/utils.ts" "$DEST_LIB/utils.ts"
for c in "${COMPONENTS[@]}"; do
  [ -f "$REG/ui/$c.tsx" ] || { echo "error: missing $c.tsx in registry"; exit 1; }
  cp "$REG/ui/$c.tsx" "$DEST_UI/$c.tsx"
done

perl -0pi -e 's#\@/registry/new-york-v4/ui/#\@/components/ui/#g' "$DEST_UI"/*.tsx

echo "vendored ${#COMPONENTS[@]} components + lib/utils.ts from $SRC"
grep -rl '@radix-ui/react-' "$DEST_UI" && echo "warning: a component imports @radix-ui/react-* - install it or re-check the source" || true
