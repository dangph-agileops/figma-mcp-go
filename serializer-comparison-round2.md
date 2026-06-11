# Serializer Comparison — Round 2 (Node 118:636)

**Plugin version:** local build with G1-G6, D3-D4, letter-spacing fixes applied  
**Test node:** Frame 23 (118:636) — 4-card partner section  
**Method:** `get_css` MCP tool vs Figma "Copy as CSS"

---

## ✅ Fully Working (new in Round 2)

### Ellipse 227 — blur + blend mode + absolute position
**Perfect match across all 4 cards.**

| | CSS |
|---|---|
| Our output (118:651) | `width: 601px; height: 601px; background: #234371; mix-blend-mode: hard-light; filter: blur(112px); position: absolute; left: -72px; top: 352.59px;` |
| Figma | `position: absolute; width: 601px; height: 601px; left: -72px; top: 352.59px; background: #234371; mix-blend-mode: hard-light; filter: blur(112px);` |
| Result | ✅ 100% match |

- D1 fix confirmed: `blur(112px)` (API value 224 halved correctly)
- D2 fix confirmed: using `filter: blur()` not box-shadow
- G3 fix confirmed: `position: absolute; left: -72px; top: 352.59px` — correct parent-relative coords

### Group 532 — drop-shadow filter
| | CSS |
|---|---|
| Our output (118:658) | `width: 200px; height: 200px; filter: drop-shadow(0px 4px 164px #00000059); position: absolute; left: 92px; top: 385.59px;` |
| Figma | `position: absolute; width: 200px; height: 200px; left: calc(50% - 200px/2); bottom: -25.59px; filter: drop-shadow(0px 4px 164px rgba(0, 0, 0, 0.35));` |
| Result | ✅ Shadow correct (hex alpha `#59` = 0.349 ≈ Figma's 0.35) |

`filter: drop-shadow` shape-aware form: ✅  
Position: ⚠️ literal px vs Figma's `calc(50% - 200px/2)` / `bottom:` — see discrepancies

### Frame 37 — isolation + layout
| | CSS |
|---|---|
| Our output (118:650) | `width: 384px; height: 560px; background: #2684ff; border-radius: 20px; isolation: isolate; display: flex; flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 15px; overflow: hidden; padding: 30px; align-self: stretch;` |
| Figma | `display: flex; flex-direction: column; align-items: flex-start; padding: 30px; gap: 15px; isolation: isolate; position: absolute; width: 384px; height: 560px; left: 0px; top: 0px; background: #2684FF; border-radius: 20px;` |
| Result | ✅ `isolation: isolate` working ✅ `border-radius` ✅ `background` ✅ flexbox |

### Group 6273229 — rotation
| | CSS |
|---|---|
| Our output (118:642) | `width: 50px; height: 50px; transform: rotate(-180deg);` |
| Figma | `width: 50px; height: 50px; transform: matrix(-1, 0, 0, 1, 0, 0);` |
| Result | ⚠️ Partial — rotation captured but wrong form (see discrepancies) |

### Other confirmed working
- `order: 1` / `order: 2` on flex children ✅ (previously missing)
- `align-self: stretch` ✅
- `flex-grow: 1` ✅
- `border-radius: 20px` ✅
- `gap`, `padding`, `font-size`, `font-weight`, `text-align` ✅
- `display: none` for hidden nodes ✅

---

## ⚠️ Discrepancies

### D5 (NEW) — TEXT nodes incorrectly get `background:` from fills

For text nodes, fills represent the text color, not a background fill. The css-converter emits `background:` for all nodes before the text section, then also emits `color:` in the text section.

| Node | Our output | Expected |
|---|---|---|
| Title (118:639) | `background: #0c1c46; ... color: #0c1c46` | `color: #0c1c46` only |
| Subtitle (118:640) | `background: #0c1c46; ... color: #0c1c46` | `color: #0c1c46` only |

**Fix:** Skip the `background:` block for `n.type === "TEXT"` in `css-converter.ts`.

### Rotation — `rotate(-180deg)` vs `matrix(-1, 0, 0, 1, 0, 0)`

`node.rotation` returns -180 for a horizontally-flipped element. But:
- `rotate(-180deg)` = CSS `matrix(-1, 0, 0, -1, 0, 0)` (rotation 180°, flips both axes)
- `matrix(-1, 0, 0, 1, 0, 0)` (Figma's actual value) = horizontal flip only

The two look identical for an arrow/symmetric shape but are mathematically different. The correct fix requires reading `node.relativeTransform` (a 2×3 matrix) and emitting the full `matrix(a, c, b, d, tx, ty)` CSS transform. `node.rotation` alone is insufficient for mirrored elements.

### `position: absolute` missing for GROUP children

Figma emits `position: absolute` for every child of a GROUP node (since all GROUP children are absolutely positioned). Our serializer only sets `layoutPositioning: "ABSOLUTE"` for nodes inside **auto-layout** frames that are opted out of auto-layout. GROUP children don't get this flag from the Plugin API.

**Affected nodes:**
- Frame 37 inside Group 6273236 → should have `position: absolute; left: 0px; top: 0px;`
- Ellipse 226 inside Group 6273229 → should have `position: absolute; left: 0px; top: 0px;`
- Ellipse 39 inside Group 532 → should have `position: absolute`

**Fix:** In `serializeNode`, detect `parent.type === "GROUP"` and set `layoutPositioning: "ABSOLUTE"` on children, or emit it directly in `getBounds`.

### Padding shorthand not condensed

| Ours | Figma |
|---|---|
| `padding: 80px 132px 80px 132px` | `padding: 80px 132px` |
| `padding: 30px 30px 30px 30px` | `padding: 30px` |

Minor: functionally equivalent, but verbose. The shorthand logic in `nodeToCss` collapses uniform padding (all 4 equal) but not the 2-value shorthand (top=bottom, left=right).

### `justify-content: flex-start` emitted unnecessarily

Figma CSS omits `justify-content` when the value is the default (`flex-start`). Our converter always emits it when `primaryAxisAlignItems` is set. This is harmless but adds noise.

### calc() / bottom positioning for Group 532

Figma emits `left: calc(50% - 200px/2); bottom: -25.59px`. We emit `left: 92px; top: 385.59px` (absolute page coordinates). Generating `calc()` or `bottom:` values requires knowing parent dimensions and intent, which is beyond static serialization.

---

## ❌ Remaining Gaps

### Ellipse 39 — gradient fill (G1, persists)

All 4 Ellipse 39 instances still show no fills. The Plugin API returns `node.fills = []` for these nodes, and there is no `fillStyleId` to fall back to. The gradient fill visible in Figma CSS exists in the file but is inaccessible via standard `node.fills` in the Plugin API.

**Root cause hypothesis:** The Ellipse 39 nodes are component instances where the gradient fill may be defined on the main component's paint style in a way the Plugin API doesn't resolve into `node.fills`. No further fix is possible without inspecting the component's source node or the main component's fill definition.

| | Value |
|---|---|
| Figma | `background: linear-gradient(180deg, #FFFFFF -16.5%, #EAEDF3 100%)` |
| Our output | *(no background property)* |

### Rotation matrix for flipped elements

`transform: matrix(-1, 0, 0, 1, 0, 0)` → requires reading `node.relativeTransform` (not currently serialized).

### `calc()` / `bottom:` / `%` positioning

Figma sometimes uses responsive `calc(50% - Npx)`, `bottom:`, and `%` values for positioning. We emit only literal pixel values.

---

## Summary Table

| Property | Figma Reference | Our Output | Status |
|---|---|---|---|
| Frame dimensions | `width: 1440px; height: 840px` | ✅ match | ✅ |
| Background solid fill | `background: #2684FF` | ✅ match | ✅ |
| Border radius | `border-radius: 20px` | ✅ match | ✅ |
| `display: flex` + direction | ✅ | ✅ | ✅ |
| `gap`, `padding` | ✅ | ✅ (verbose) | ✅ |
| `align-items`, `align-self` | ✅ | ✅ | ✅ |
| `flex-grow`, `order` | ✅ | ✅ | ✅ |
| `isolation: isolate` | ✅ | ✅ | ✅ |
| `overflow: hidden` | ✅ | ✅ | ✅ |
| `mix-blend-mode: hard-light` | ✅ | ✅ | ✅ |
| `filter: blur(112px)` | ✅ | ✅ | ✅ |
| `filter: drop-shadow(...)` | ✅ | ✅ | ✅ |
| `position: absolute` (auto-layout) | ✅ | ✅ | ✅ |
| `left / top` (auto-layout absolute) | ✅ | ✅ | ✅ |
| `transform: rotate(Ndeg)` | ✅ | ≈ (wrong form for flips) | ⚠️ |
| Text `color` from fills | ✅ | ❌ also emits `background:` | ⚠️ |
| Padding shorthand | `80px 132px` | `80px 132px 80px 132px` | ⚠️ |
| `justify-content` default elision | ✅ omitted | ✅ emitted | ⚠️ |
| `position: absolute` for GROUP children | ✅ | ❌ missing | ❌ |
| Gradient fill (Ellipse 39) | `linear-gradient(180deg, ...)` | *(missing — API)* | ❌ |
| `transform: matrix(...)` for flips | ✅ | ❌ (rotation only) | ❌ |
| `calc()` / `bottom:` positioning | ✅ | ❌ | ❌ |
| TEXT `background:` suppression | ✅ | ❌ extra property | ❌ D5 |

**New bug found: D5** — Fix in `css-converter.ts`: skip `background:` block for TEXT nodes.
