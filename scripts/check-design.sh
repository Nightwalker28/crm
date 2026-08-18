#!/usr/bin/env bash
# Source-level design guard for frontend/.
#
# Enforces the mechanically checkable rules in docs/design/design.md. Each check
# names the section it comes from, so a failure is read alongside the rule rather
# than guessed at.
#
# This is deliberately the *source* half of the guard. The rendered half lives in
# frontend/tests/e2e/design-rules.spec.ts and scroll-containers.spec.ts, which read
# computed styles from every route and catch what grep cannot (a <code> element
# inheriting a monospace UA default, a height cap arriving through a call-site
# className, an id column that turns out to hold plain integers). Rules that need
# rendering — §3.1 Inter everywhere, §3.2 monospace only for machine strings,
# §8 contrast floors — are not duplicated here.
#
# Exemptions:
#   - Documented path exceptions are hardcoded below with the section that allows them.
#   - Anything else legitimate: put `design-exempt: <reason>` in a comment on the
#     offending line. Mark the line, do not widen the check — and if the exemption is
#     a new class of case, write it into docs/design/design.md first (§12).
#
# Usage: ./scripts/check-design.sh   (also run as part of ./scripts/codex-check.sh)
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FE_DIRS=(frontend/app frontend/components frontend/lib)
TSX=(--include=*.tsx)
TS_TSX=(--include=*.tsx --include=*.ts)

# §2.5 exception 1 — third-party brand marks (Google/Microsoft OAuth logos, LinkedIn).
BRAND_MARK_FILES='frontend/app/auth/login/page.tsx|frontend/components/contacts/contactList.tsx'
# §2.5 exception 2 — the invoice print document carries its own operator-picked theme
# and must not follow the app theme.
INVOICE_PRINT='frontend/app/dashboard/finance/pos/\[invoiceId\]/print/'

MAX_SHOWN=25
failures=0
checks=0

# check <title> <doc section> <fix hint> <matches>
check() {
  local title="$1" section="$2" hint="$3" matches="$4"
  checks=$((checks + 1))
  if [ -n "$matches" ]; then
    local count
    count="$(printf '%s\n' "$matches" | wc -l | tr -d ' ')"
    echo "FAIL  $title  ($section, $count match(es))"
    printf '%s\n' "$matches" | head -n "$MAX_SHOWN" | sed 's/^/        /'
    if [ "$count" -gt "$MAX_SHOWN" ]; then
      echo "        ... and $((count - MAX_SHOWN)) more"
    fi
    echo "        fix: $hint"
    echo
    failures=$((failures + 1))
  else
    echo "ok    $title  ($section)"
  fi
}

# Drop lines carrying an explicit exemption marker.
unexempt() { grep -v 'design-exempt' || true; }

echo "== Design rules (docs/design/design.md) =="
echo

# --- §2 Colour -------------------------------------------------------------------

check "No raw hex in components" "§2.5" \
  "map to a semantic token; if none fits, add it in globals.css and derive its light value (tokens.md §4)" \
  "$(grep -rnE '#[0-9a-fA-F]{3,8}\b' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null \
     | grep -vE "^($BRAND_MARK_FILES):" \
     | grep -vE "^$INVOICE_PRINT" \
     | unexempt)"

check "No Tailwind palette colours" "§2.5" \
  "Tailwind's own palette does not follow the theme; use bg-surface-*/text-copy-*/border-line-*/status tokens" \
  "$(grep -rnE '\b(bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)\b' \
       "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null \
     | grep -vE "^$INVOICE_PRINT" \
     | unexempt)"

check "Focus ring is its own token" "§2.3" \
  "use ring-focus / --color-focus-ring, never the action colour" \
  "$(grep -rn 'ring-primary' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null | unexempt)"

# --- §3 Typography ---------------------------------------------------------------

check "Sentence case, no shouting" "§3.5" \
  "a quiet header is text-2xs font-semibold text-copy-label, not uppercase or wide tracking" \
  "$(grep -rnE '\b(uppercase|tracking-(wide|wider|widest))\b' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null \
     | grep -E 'className|class=|cva\(|cn\(|\b(text|font|bg|border|px|py|gap|flex)-' \
     | unexempt)"

check "No hand-tuned line heights" "§3.3" \
  "if it wraps it is prose: use text-p-xs / text-p-sm / text-p-base instead of text-sm + leading-6" \
  "$(grep -rnE 'text-(2xs|xs|sm|base|lg|xl)[^\"'\''\`]*leading-([0-9]|\[)' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null | unexempt)"

# --- §4 Space and size -----------------------------------------------------------

check "Spacing stays on the 4px grid" "§4.1" \
  "use a Tailwind step; arbitrary pixel spacing is off-grid" \
  "$(grep -rnE '\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[[0-9.]+(px|rem|em)\]' \
       "${FE_DIRS[@]}" "${TSX[@]}" 2>/dev/null | unexempt)"

check "No call-site control heights" "§4.2" \
  "control heights are a closed set (32/38/44) — add a size variant, do not pass h-* at the call site" \
  "$(grep -rnE '<(Input|Textarea|Button|Select|SelectTrigger|SearchBar|Combobox)\b[^>]*className="[^"]*\b(h|size)-([0-9]|\[[0-9])' \
       "${FE_DIRS[@]}" "${TSX[@]}" 2>/dev/null | unexempt)"

# The named Tailwind radius aliases are deliberately unmapped in globals.css, so a
# leftover emits no CSS at all and silently renders a square corner. A computed-style
# check cannot catch that (border-radius: 0 is legitimate elsewhere), so it is caught
# here at the source.
check "No bare Tailwind radius aliases" "§4.3" \
  "rounded-[var(--radius-control)] for buttons/inputs, --radius-card for cards/tables, --radius-panel, --radius-dialog; rounded-full and rounded-none are still allowed" \
  "$(grep -rnE '\brounded-(sm|md|lg|xl|2xl|3xl)\b' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null | unexempt)"

check "ModuleTableShell carries no height cap" "§4.5, §11.1" \
  "constrain the page layout (flex h-full min-h-0 flex-col), never cap the shell — a cap re-creates the nested scroll on every list page" \
  "$(
     { grep -rn -A3 '<ModuleTableShell' "${FE_DIRS[@]}" "${TSX[@]}" 2>/dev/null | grep 'max-h-'
       grep -nE 'max-h-' frontend/components/ui/ModuleTableShell.tsx 2>/dev/null \
         | grep -vE '^[0-9]+: *(\*|//|/\*)' \
         | sed 's|^|frontend/components/ui/ModuleTableShell.tsx:|'
     } | unexempt)"

check "No implicit scroll from overflow-x-hidden" "§4.5" \
  "CSS computes the other axis to auto, so the element silently becomes a scroll container — use overflow-x-clip" \
  "$(grep -rnE '\boverflow-x-hidden\b' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null \
     | grep -v 'overflow-y-' \
     | unexempt)"

# --- §5 Icons / §7.2 Component sources --------------------------------------------

check "lucide is the only icon source" "§5, §7.2" \
  "every glyph comes from lucide-react; do not add a second icon package" \
  "$(grep -rnE "from ['\"](react-icons|@heroicons|@tabler/icons|phosphor-react|@phosphor-icons|@fortawesome|feather-icons|@radix-ui/react-icons)" \
       "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null | unexempt)"

check "No hand-authored SVG paths" "§5" \
  "use a lucide glyph; only third-party brand marks may be hand-authored" \
  "$(grep -rn '<path' "${FE_DIRS[@]}" "${TSX[@]}" 2>/dev/null \
     | grep -vE "^($BRAND_MARK_FILES):" \
     | unexempt)"

check "shadcn is the only component library" "§7.2" \
  "vendor the shadcn primitive into components/ui/ and re-skin it with Lynk tokens instead of adding a UI library" \
  "$(grep -nE '"(@headlessui/react|@mui/[a-z-]+|antd|@chakra-ui/[a-z-]+|react-bootstrap|bootstrap|@mantine/[a-z-]+|primereact|semantic-ui-react|react-icons|@heroicons/react|@tabler/icons-react|@fortawesome/[a-z-]+)"' \
       frontend/package.json 2>/dev/null \
     | sed 's|^|frontend/package.json:|' \
     | unexempt)"

# --- §6 Motion --------------------------------------------------------------------

check "Motion transitions named properties" "§6" \
  "transition specific properties (transition-[background-color,border-color,color,box-shadow]), never transition-all" \
  "$(grep -rnE '\btransition-all\b' "${FE_DIRS[@]}" "${TS_TSX[@]}" 2>/dev/null | unexempt)"

echo
if [ "$failures" -gt 0 ]; then
  echo "Design check: $failures of $checks rules failing."
  echo "Read the named section in docs/design/design.md before changing anything."
  echo "A legitimate case is marked on the line with a 'design-exempt: <reason>' comment;"
  echo "a new class of exemption goes into docs/design/design.md first (§12)."
  exit 1
fi

echo "Design check: all $checks rules pass."
