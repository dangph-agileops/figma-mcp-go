# figma-mcp-go — Serializer Gap Report & Development Plan

**Repo:** `vkhanhqui/figma-mcp-go`  
**Commit investigated:** `8c1ad2de`  
**Verified against:** manual Figma CSS export of node `118:650`

---

## Repository Structure (confirmed)

```
figma-mcp-go/
├── cmd/figma-mcp-go/              ← Go binary entry point
├── internal/
│   ├── node.go                    ← WebSocket relay + NormalizeNodeID
│   ├── tools.go                   ← makeHandler / renderResponse / toStringSlice helpers
│   ├── tools_read.go              ← registerReadTools() — all read tool registrations
│   └── tools_write.go             ← registerWriteTools() — all write tool registrations
├── plugin/
│   └── src/
│       ├── serializers.ts         ← THE core serialization engine (all gaps are here)
│       └── read-handlers.ts       ← handleReadRequest switchboard → Figma API calls
└── npm/
    ├── bin/run.js                 ← platform launcher
    └── package.json
```

**Build output:** `plugin/src/*.ts` → `plugin/code.js` (auto-generated, never edit directly)

---

## 1. Root Cause Summary

All 18 missing CSS properties trace to a single source:
**`plugin/src/serializers.ts`** was designed to serve write tools, not CSS extraction.
The Figma Plugin API exposes every missing property inside the sandbox — they simply
were never read.

---

## 2. Fix Plan — Modify Existing Files

---

### Fix 1 — `serializePaints`: add gradient and image paint support

**File:** `plugin/src/serializers.ts`  
**Function:** `serializePaints` (lines 15–35)  
**Problem:** Line 18 hard-filters to `SOLID` only. `LINEAR_GRADIENT`, `RADIAL_GRADIENT`,
and `IMAGE` paints return `undefined` silently, causing `fills` to be omitted.

**CSS properties unlocked:** `background: linear-gradient(...)`, `background-image: url(...)`

```typescript
// plugin/src/serializers.ts — replace serializePaints

export const serializePaints = (paints: any) => {
  if (isMixed(paints)) return "mixed";
  if (!paints || !Array.isArray(paints)) return undefined;

  const result = paints
    .filter((p: any) => p.visible !== false)
    .map((paint: any) => {

      // --- SOLID (existing behaviour, unchanged) ---
      if (paint.type === "SOLID") {
        const hex = toHex(paint.color);
        const opacity = paint.opacity ?? 1;
        return opacity === 1
          ? hex
          : hex + Math.round(opacity * 255).toString(16).padStart(2, "0");
      }

      // --- GRADIENTS (new) ---
      if (paint.type === "LINEAR_GRADIENT" || paint.type === "RADIAL_GRADIENT" ||
          paint.type === "ANGULAR_GRADIENT" || paint.type === "DIAMOND_GRADIENT") {
        return {
          type: paint.type,
          stops: (paint.gradientStops ?? []).map((s: any) => ({
            color: toHex(s.color) +
              (s.color.a < 1
                ? Math.round(s.color.a * 255).toString(16).padStart(2, "0")
                : ""),
            position: pixelRound(s.position),
          })),
          transform: paint.gradientTransform, // raw 2×3 matrix; consumer derives angle
        };
      }

      // --- IMAGE (new) ---
      if (paint.type === "IMAGE") {
        return {
          type: "IMAGE",
          scaleMode: paint.scaleMode,   // "FILL" | "FIT" | "CROP" | "TILE"
          imageHash: paint.imageHash,
        };
      }

      return undefined;
    })
    .filter(Boolean);

  return result.length > 0 ? result : undefined;
};
```

---

### Fix 2 — `serializeStyles`: add effects, blend mode, stroke weight, per-corner radii, auto-layout, visibility, opacity

**File:** `plugin/src/serializers.ts`  
**Function:** `serializeStyles` (lines 50–87)  
**Problem:** 10 properties available in the Figma Plugin API are never read.

**CSS properties unlocked:**
`filter: blur()`, `filter: drop-shadow()`, `box-shadow`, `mix-blend-mode`,
`border-width`, `border-radius: 0 20px 20px 0`, `display: flex`, `flex-direction`,
`gap`, `align-items`, `justify-content`, `overflow: hidden`, `display: none`, `opacity`

```typescript
// plugin/src/serializers.ts — extend serializeStyles
// Add the following blocks inside the function, after the existing padding block.

  // --- per-corner radii (fix for cornerRadius: "mixed") ---
  // Figma Plugin API: node.topLeftRadius, topRightRadius, bottomRightRadius, bottomLeftRadius
  if ("cornerRadius" in node && isMixed(node.cornerRadius)) {
    styles.cornerRadius = "mixed";
    styles.topLeftRadius     = node.topLeftRadius     ?? 0;
    styles.topRightRadius    = node.topRightRadius    ?? 0;
    styles.bottomRightRadius = node.bottomRightRadius ?? 0;
    styles.bottomLeftRadius  = node.bottomLeftRadius  ?? 0;
  }

  // --- stroke weight + alignment ---
  // Figma Plugin API: node.strokeWeight, node.strokeAlign
  if ("strokeWeight" in node && node.strokeWeight) {
    styles.strokeWeight = node.strokeWeight;
    if ("strokeAlign" in node) styles.strokeAlign = node.strokeAlign;
    // strokeAlign values: "INSIDE" | "OUTSIDE" | "CENTER"
  }

  // --- blend mode ---
  // Figma Plugin API: node.blendMode
  if ("blendMode" in node && node.blendMode !== "NORMAL") {
    styles.blendMode = node.blendMode;
    // e.g. "HARD_LIGHT" → CSS "hard-light" (mapping in get_css converter)
  }

  // --- opacity ---
  // Figma Plugin API: node.opacity
  if ("opacity" in node && node.opacity !== 1) {
    styles.opacity = node.opacity;
  }

  // --- visibility ---
  // Figma Plugin API: node.visible
  if ("visible" in node && node.visible === false) {
    styles.visible = false;
  }

  // --- effects: shadows + blurs ---
  // Figma Plugin API: node.effects — array of Effect objects
  if ("effects" in node && Array.isArray(node.effects) && node.effects.length > 0) {
    const active = node.effects.filter((e: any) => e.visible !== false);
    if (active.length > 0) {
      styles.effects = active.map((e: any) => {
        if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
          return {
            type: e.type,
            color: toHex(e.color) +
              (e.color.a < 1
                ? Math.round(e.color.a * 255).toString(16).padStart(2, "0")
                : ""),
            offsetX:  e.offset?.x ?? 0,
            offsetY:  e.offset?.y ?? 0,
            blur:     e.radius   ?? 0,
            spread:   e.spread   ?? 0,
          };
        }
        if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
          return { type: e.type, blur: e.radius ?? 0 };
        }
        return { type: e.type };
      });
    }
  }

  // --- auto-layout (flex container) ---
  // Figma Plugin API: node.layoutMode, primaryAxisAlignItems, counterAxisAlignItems,
  //   primaryAxisSizingMode, counterAxisSizingMode, itemSpacing, clipsContent
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    styles.layoutMode               = node.layoutMode;              // "HORIZONTAL" | "VERTICAL"
    styles.primaryAxisAlignItems    = node.primaryAxisAlignItems;   // "MIN"|"CENTER"|"MAX"|"SPACE_BETWEEN"
    styles.counterAxisAlignItems    = node.counterAxisAlignItems;   // "MIN"|"CENTER"|"MAX"|"BASELINE"
    styles.primaryAxisSizingMode    = node.primaryAxisSizingMode;   // "FIXED" | "AUTO"
    styles.counterAxisSizingMode    = node.counterAxisSizingMode;
    styles.itemSpacing              = node.itemSpacing;
    if ("counterAxisSpacing" in node) styles.counterAxisSpacing = node.counterAxisSpacing;
    if ("clipsContent" in node)       styles.clipsContent       = node.clipsContent;
  }

  // --- auto-layout child props ---
  // Figma Plugin API: node.layoutAlign, node.layoutGrow, node.layoutPositioning
  if ("layoutAlign"       in node) styles.layoutAlign       = node.layoutAlign;
  if ("layoutGrow"        in node && node.layoutGrow)
                                   styles.layoutGrow        = node.layoutGrow;
  if ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE")
                                   styles.layoutPositioning = "ABSOLUTE";
```

---

### Fix 3 — `serializeText`: add `textCase`

**File:** `plugin/src/serializers.ts`  
**Function:** `serializeText` (lines 105–142)  
**Problem:** `node.textCase` is never read. Maps to CSS `text-transform`.

**CSS property unlocked:** `text-transform: uppercase / lowercase / capitalize`

```typescript
// plugin/src/serializers.ts — add inside serializeText return, after textAlignHorizontal

textCase: isMixed(node.textCase)
  ? "mixed"
  : node.textCase !== "ORIGINAL"
    ? node.textCase   // "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS"
    : undefined,
```

---

### Fix 4 — `getBounds`: add constraint metadata

**File:** `plugin/src/serializers.ts`  
**Function:** `getBounds` (lines 37–48)  
**Problem:** Returns x/y/width/height but not `node.constraints`, so
`left: calc(50% - Npx)` and `bottom:` positioning can never be derived.

**CSS property unlocked:** accurate `left`, `right`, `top`, `bottom` when constraints
are `CENTER`, `SCALE`, or `STRETCH`.

```typescript
// plugin/src/serializers.ts — replace getBounds

export const getBounds = (node: any) => {
  if (!("x" in node && "y" in node && "width" in node && "height" in node)) {
    return undefined;
  }
  const base = {
    x:      pixelRound(node.x),
    y:      pixelRound(node.y),
    width:  pixelRound(node.width),
    height: pixelRound(node.height),
  };
  // Figma Plugin API: node.constraints → { horizontal, vertical }
  // Values: "LEFT" | "RIGHT" | "CENTER" | "SCALE" | "STRETCH"
  if ("constraints" in node && node.constraints) {
    return { ...base, constraints: node.constraints };
  }
  return base;
};
```

---

### Fix 5 — `deduplicateStyles`: extend to cover new fields

**File:** `plugin/src/serializers.ts`  
**Function:** `deduplicateStyles` (lines 166–209)  
**Problem:** Only deduplicates `fills` and `strokes`. Once `effects` objects
and gradient paint objects are added, large files will bloat unless they are
also deduplicated.

```typescript
// plugin/src/serializers.ts — extend countWalk and replaceWalk

// In countWalk — add after existing fills/strokes counting:
if (Array.isArray(s.effects))
  counts.set(JSON.stringify(s.effects),
    (counts.get(JSON.stringify(s.effects)) ?? 0) + 1);

// In replaceWalk — add after existing fills/strokes replacement:
if (Array.isArray(s.effects)) {
  const ref = keyToRef.get(JSON.stringify(s.effects));
  if (ref) newStyles = { ...newStyles, effects: ref };
}
```

---

## 3. New Tool — `get_css`

This is a higher-level tool that converts node data into ready-to-paste CSS strings.
It requires changes in both the Go server and the plugin.

---

### 3a. Go server — register the tool

**File:** `internal/tools_read.go`  
**Where:** inside `registerReadTools()`, after the `get_nodes_info` block  
**Pattern:** follows identical `func(ctx, req)` pattern used for `get_node`

```go
// internal/tools_read.go — add inside registerReadTools()

s.AddTool(mcp.NewTool("get_css",
    mcp.WithDescription(
        "Return ready-to-use CSS for one or more nodes. Covers layout (flexbox), "+
        "fills (solid + gradient), strokes, effects (shadows/blur), typography, "+
        "border-radius, opacity, blend mode, and visibility. "+
        "Returns a map of nodeId → CSS block string."),
    mcp.WithArray("nodeIds",
        mcp.Required(),
        mcp.Description("Node IDs in colon format e.g. ['118:650', '118:656']"),
        mcp.WithStringItems(),
    ),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
    raw, _ := req.GetArguments()["nodeIds"].([]interface{})
    nodeIDs := toStringSlice(raw)
    resp, err := node.Send(ctx, "get_css", nodeIDs, nil)
    return renderResponse(resp, err)
})
```

---

### 3b. Plugin — add handler case

**File:** `plugin/src/read-handlers.ts`  
**Where:** inside the `handleReadRequest` switch / if-chain  
**Pattern:** follows the same `get_node` pattern (lines 25–36)

```typescript
// plugin/src/read-handlers.ts — add new case inside handleReadRequest

if (msg.type === "get_css") {
  const nodeIds: string[] = msg.nodeIds ?? [];
  const result: Record<string, string> = {};
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) { result[id] = "/* node not found */"; continue; }
    const serialized = await serializeNode(node as any);
    result[id] = nodeToCss(serialized);
  }
  return result;
}
```

---

### 3c. Plugin — add CSS converter

**File:** `plugin/src/css-converter.ts` *(new file)*  
**Exports:** `nodeToCss(serialized: any): string`

This file contains all the Figma enum → CSS value maps and the CSS string builder.
It imports `toHex` from `serializers.ts` — no circular dependency.

```typescript
// plugin/src/css-converter.ts  (NEW FILE)

const BLEND_MODE: Record<string, string> = {
  MULTIPLY: "multiply",   SCREEN: "screen",     OVERLAY: "overlay",
  DARKEN: "darken",       LIGHTEN: "lighten",   COLOR_DODGE: "color-dodge",
  COLOR_BURN: "color-burn", HARD_LIGHT: "hard-light", SOFT_LIGHT: "soft-light",
  DIFFERENCE: "difference", EXCLUSION: "exclusion", HUE: "hue",
  SATURATION: "saturation", COLOR: "color",     LUMINOSITY: "luminosity",
};

const FLEX_DIRECTION:  Record<string, string> = { HORIZONTAL: "row", VERTICAL: "column" };
const JUSTIFY_CONTENT: Record<string, string> = {
  MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between",
};
const ALIGN_ITEMS: Record<string, string> = {
  MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline",
};
const TEXT_TRANSFORM: Record<string, string> = {
  UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize",
};

export function nodeToCss(n: any): string {
  const s  = n.styles ?? {};
  const b  = n.bounds  ?? {};
  const ln: string[] = [];

  // ── Dimensions ──────────────────────────────────────────────────────
  if (b.width  != null) ln.push(`width: ${b.width}px`);
  if (b.height != null) ln.push(`height: ${b.height}px`);

  // ── Background / fills ──────────────────────────────────────────────
  if (Array.isArray(s.fills)) {
    const bgs = s.fills.map(fillToCss).filter(Boolean) as string[];
    if (bgs.length) ln.push(`background: ${bgs.join(", ")}`);
  }

  // ── Border ──────────────────────────────────────────────────────────
  if (Array.isArray(s.strokes) && s.strokes.length > 0) {
    const color = typeof s.strokes[0] === "string" ? s.strokes[0] : "#000000";
    const w     = s.strokeWeight ?? 1;
    ln.push(`border: ${w}px solid ${color}`);
    if (s.strokeAlign === "OUTSIDE") ln.push(`box-sizing: content-box`);
  }

  // ── Border radius ───────────────────────────────────────────────────
  if (s.topLeftRadius !== undefined) {
    ln.push(
      `border-radius: ${s.topLeftRadius}px ${s.topRightRadius}px ` +
      `${s.bottomRightRadius}px ${s.bottomLeftRadius}px`
    );
  } else if (s.cornerRadius && s.cornerRadius !== "mixed") {
    ln.push(`border-radius: ${s.cornerRadius}px`);
  }

  // ── Opacity ─────────────────────────────────────────────────────────
  if (s.opacity != null) ln.push(`opacity: ${s.opacity}`);

  // ── Visibility ──────────────────────────────────────────────────────
  if (s.visible === false) ln.push(`display: none`);

  // ── Blend mode ──────────────────────────────────────────────────────
  if (s.blendMode && BLEND_MODE[s.blendMode]) {
    ln.push(`mix-blend-mode: ${BLEND_MODE[s.blendMode]}`);
  }

  // ── Effects ─────────────────────────────────────────────────────────
  if (Array.isArray(s.effects) && s.effects.length > 0) {
    const filters:  string[] = [];
    const shadows:  string[] = [];
    let   backdrop            = "";
    for (const e of s.effects) {
      if (e.type === "LAYER_BLUR")
        filters.push(`blur(${e.blur}px)`);
      if (e.type === "BACKGROUND_BLUR")
        backdrop = `backdrop-filter: blur(${e.blur}px)`;
      if (e.type === "DROP_SHADOW")
        shadows.push(
          `${e.offsetX}px ${e.offsetY}px ${e.blur}px ${e.spread ?? 0}px ${e.color}`);
      if (e.type === "INNER_SHADOW")
        shadows.push(
          `inset ${e.offsetX}px ${e.offsetY}px ${e.blur}px ${e.spread ?? 0}px ${e.color}`);
    }
    if (filters.length)  ln.push(`filter: ${filters.join(" ")}`);
    if (shadows.length)  ln.push(`box-shadow: ${shadows.join(", ")}`);
    if (backdrop)        ln.push(backdrop);
  }

  // ── Auto-layout → flexbox ───────────────────────────────────────────
  if (s.layoutMode && s.visible !== false) {
    ln.push(`display: flex`);
    ln.push(`flex-direction: ${FLEX_DIRECTION[s.layoutMode] ?? "row"}`);
    if (s.primaryAxisAlignItems)
      ln.push(`justify-content: ${JUSTIFY_CONTENT[s.primaryAxisAlignItems] ?? "flex-start"}`);
    if (s.counterAxisAlignItems)
      ln.push(`align-items: ${ALIGN_ITEMS[s.counterAxisAlignItems] ?? "flex-start"}`);
    if (s.itemSpacing) ln.push(`gap: ${s.itemSpacing}px`);
    if (s.clipsContent) ln.push(`overflow: hidden`);
  }

  // ── Padding ─────────────────────────────────────────────────────────
  if (s.padding) {
    const { top, right, bottom, left } = s.padding;
    ln.push(
      top === right && right === bottom && bottom === left
        ? `padding: ${top}px`
        : `padding: ${top}px ${right}px ${bottom}px ${left}px`
    );
  }

  // ── Typography ──────────────────────────────────────────────────────
  if (n.type === "TEXT") {
    if (s.fontFamily)  ln.push(`font-family: '${s.fontFamily}', sans-serif`);
    if (s.fontSize)    ln.push(`font-size: ${s.fontSize}px`);
    if (s.fontWeight)  ln.push(`font-weight: ${s.fontWeight}`);
    if (s.lineHeight?.unit === "PERCENT")
                       ln.push(`line-height: ${s.lineHeight.value}%`);
    if (s.lineHeight?.unit === "PIXELS")
                       ln.push(`line-height: ${s.lineHeight.value}px`);
    if (s.letterSpacing?.value)
                       ln.push(
                         `letter-spacing: ${s.letterSpacing.value}` +
                         `${s.letterSpacing.unit === "PERCENT" ? "em" : "px"}`);
    if (s.textAlignHorizontal)
                       ln.push(`text-align: ${s.textAlignHorizontal.toLowerCase()}`);
    if (s.textCase && TEXT_TRANSFORM[s.textCase])
                       ln.push(`text-transform: ${TEXT_TRANSFORM[s.textCase]}`);
    // text color comes from fills
    if (Array.isArray(s.fills) && typeof s.fills[0] === "string")
                       ln.push(`color: ${s.fills[0]}`);
  }

  // ── Flex child ──────────────────────────────────────────────────────
  if (s.layoutAlign === "STRETCH") ln.push(`align-self: stretch`);
  if (s.layoutGrow  === 1)        ln.push(`flex-grow: 1`);

  return ln.map(l => `  ${l};`).join("\n");
}

function fillToCss(fill: any): string | undefined {
  if (typeof fill === "string") return fill;           // solid hex
  if (!fill?.type) return undefined;
  if (fill.type.endsWith("_GRADIENT") && Array.isArray(fill.stops)) {
    // gradient angle derivation from 2×3 transform matrix is non-trivial;
    // emit a linear-gradient as a best-effort approximation
    const stops = fill.stops
      .map((s: any) => `${s.color} ${Math.round(s.position * 100)}%`)
      .join(", ");
    return `linear-gradient(${stops})`;
  }
  return undefined;
}
```

---

## 4. Full File-Path Matrix

| # | What changes | File path | Type |
|---|---|---|---|
| 1 | Gradient + image paint handling | `plugin/src/serializers.ts` | modify |
| 2 | Effects, blend mode, stroke weight | `plugin/src/serializers.ts` | modify |
| 3 | Per-corner radii | `plugin/src/serializers.ts` | modify |
| 4 | Auto-layout + flex child props | `plugin/src/serializers.ts` | modify |
| 5 | Visibility + opacity | `plugin/src/serializers.ts` | modify |
| 6 | `textCase` → `text-transform` | `plugin/src/serializers.ts` | modify |
| 7 | Constraint metadata in bounds | `plugin/src/serializers.ts` | modify |
| 8 | Extend `deduplicateStyles` for effects | `plugin/src/serializers.ts` | modify |
| 9 | Register `get_css` tool in Go server | `internal/tools_read.go` | modify |
| 10 | Add `get_css` case in plugin switchboard | `plugin/src/read-handlers.ts` | modify |
| 11 | CSS converter logic | `plugin/src/css-converter.ts` | **new file** |
| 12 | Import `nodeToCss` in read-handlers | `plugin/src/read-handlers.ts` | modify |
| — | Compiled plugin output (auto-generated) | `plugin/code.js` | rebuild |

**No changes needed:**
- `internal/node.go` — relay is transparent, passes JSON as-is
- `internal/tools.go` — `makeHandler` / `renderResponse` helpers unchanged
- `internal/tools_write.go` — write tools unaffected
- `cmd/figma-mcp-go/` — binary entry point unchanged
- `npm/` — distribution wrapper unchanged

---

## 5. Effort & Priority

| # | Fix | Effort | Priority |
|---|---|---|---|
| 1 | Gradient / image fills in `serializePaints` | S | High |
| 2 | Effects (shadows + blur) in `serializeStyles` | M | High |
| 3 | Auto-layout properties in `serializeStyles` | M | High |
| 4 | `blendMode` in `serializeStyles` | S | High |
| 5 | `strokeWeight` in `serializeStyles` | S | High |
| 6 | Per-corner radii in `serializeStyles` | S | High |
| 7 | `visible` + `opacity` in `serializeStyles` | S | Medium |
| 8 | Layout child props in `serializeStyles` | S | Medium |
| 9 | `textCase` in `serializeText` | S | Medium |
| 10 | Constraints in `getBounds` | S | Medium |
| 11 | Extend `deduplicateStyles` | S | Medium |
| 12 | New `get_css` tool (Go + plugin + converter) | L | Medium |

**Effort key:** S = < 1 hr · M = 1–4 hrs · L = 1–2 days

---

## 6. Rollout Notes

**Plugin recompile required for all items.**  
`plugin/src/*.ts` compiles to `plugin/code.js` via `npm run build` in `/plugin`.
Users must re-import the plugin manifest from the updated `plugin.zip` release.
This is the standard plugin update path.

**No Go recompile for items 1–8** (serializer-only fixes).  
The Go binary is a transparent JSON relay; richer plugin output flows through
automatically. Only item 9 (`get_css` tool registration) requires a new Go binary release.

**Backward compatible.** All serializer changes add new keys to the `styles` object.
No existing keys are removed or renamed. Existing tool callers are unaffected.

---

## 7. Post-Implementation Notes

### Round 1 fixes (initial plan implementation)

All 12 plan items implemented. One extra bug found during review.

**Bug fix — letter spacing `PERCENT → em`** (`css-converter.ts`)  
Figma stores percent letter spacing as % of font size; CSS `em` = value / 100.  
`5%` must emit `0.05em`, not `5em`. Applied: `+(value / 100).toFixed(4)}em`.

| Property | `serializers.ts` | `css-converter.ts` |
|---|---|---|
| `line-height` | ✓ correct before plan | ✓ correct in plan |
| `letter-spacing` | ✓ correct before plan | ✗ unit bug — **fixed** |

---

### Round 2 fixes (remaining gaps)

**D3 — NOISE effect type filtered** (`serializers.ts`)  
Effects filter now accepts only `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR`.  
`NOISE` and any future unknown types are dropped before serialization.

**D4 — `strokeWeight` gated on non-empty strokes** (`serializers.ts`)  
`strokeWeight` / `strokeAlign` are now emitted only when `node.strokes.length > 0`.  
Previously leaked a large non-zero `strokeWeight` on Ellipse 227 with no visible border.

**G1 — fillStyleId fallback for empty fills** (`serializers.ts`)  
When `node.fills` is empty but `fillStyleId` is set, the serializer now reads `style.paints`  
from `figma.getStyleByIdAsync(fillStyleId)`. Covers component instances where the fill  
lives on the style object rather than being resolved onto the node directly.

**G2 — Gradient angle from 2×3 transform matrix** (`css-converter.ts`)  
`fillToCss` now derives the CSS angle from Figma's `gradientTransform`:  
`angle = atan2(transform[0][0], -transform[1][0]) × 180/π` (normalized to 0–360).  
`LINEAR_GRADIENT` → `linear-gradient(Ndeg, stops)`.  
`RADIAL_GRADIENT` → `radial-gradient(stops)`.  
`ANGULAR_GRADIENT` / `DIAMOND_GRADIENT` → `conic-gradient(stops)`.

**G3 — `position: absolute` with parent-relative `left/top`** (`css-converter.ts`)  
When `layoutPositioning === "ABSOLUTE"`, the converter now emits:  
`position: absolute; left: ${b.x}px; top: ${b.y}px`.  
`node.x` / `node.y` in the Figma Plugin API are already parent-relative, so no  
additional coordinate transformation is needed.

**G4 — `isolation: isolate`** (`serializers.ts` + `css-converter.ts`)  
`serializeStyles` checks direct children for non-`NORMAL`/`PASS_THROUGH` blend modes  
and sets `styles.isolate = true`. The converter emits `isolation: isolate` when set.

**G5 — `z-index` and flex `order`** (`serializers.ts` + `css-converter.ts`)  
`serializeNode` now receives and stores the child index as `_order` on each node.  
The converter emits `z-index: N` for absolutely positioned children and `order: N`  
for other children, both only when `N > 0` (matching Figma's CSS export behaviour).

**G6 — `transform: rotate()`** (`serializers.ts` + `css-converter.ts`)  
`serializeStyles` now reads `node.rotation` (degrees, clockwise — same convention as CSS).  
The converter emits `transform: rotate(${s.rotation}deg)` when non-zero.

**G7 — `get_css` tool** (`internal/tools_read_document.go`)  
Already registered in source. Active after server restart.

**Letter-spacing fix applied** — see Round 1 notes above.