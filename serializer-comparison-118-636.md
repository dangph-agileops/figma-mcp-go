# Serializer Comparison — Node 118:636 (Frame 23)

**Figma file:** New-brand-website-2026--Copy  
**Node:** Frame 23 (118:636) — product card section (4 partner cards: Atlassian, Salesforce, Slack, Google)  
**Test:** `get_node` output from the updated local plugin vs Figma's "Copy as CSS" export  
**Plugin version:** local build with serializer gap fixes applied  

---

## ✅ Properties Now Correctly Captured

### 1. Auto-layout / Flexbox

All auto-layout properties are now present and accurate across every frame in the tree.

| Property | Figma CSS | Our serializer | CSS converter output |
|---|---|---|---|
| flex direction | `flex-direction: column` | `layoutMode: "VERTICAL"` | `flex-direction: column` ✅ |
| gap | `gap: 32px` | `itemSpacing: 32` | `gap: 32px` ✅ |
| align-items | `align-items: flex-start` | `counterAxisAlignItems: "MIN"` | `align-items: flex-start` ✅ |
| justify-content | `justify-content: center` | `primaryAxisAlignItems: "CENTER"` | `justify-content: center` ✅ |
| padding | `padding: 80px 132px` | `padding: {top:80, right:132, bottom:80, left:132}` | `padding: 80px 132px 80px 132px` ✅ |
| overflow | `overflow: hidden` (clips) | `clipsContent: true` | `overflow: hidden` ✅ |

**Example — Frame 23 (root):**
```
Figma:       display: flex; flex-direction: column; align-items: flex-start; padding: 80px 132px; gap: 32px;
Serializer:  layoutMode: "VERTICAL", itemSpacing: 32, counterAxisAlignItems: "MIN", padding: {top:80,right:132,...}
```

### 2. Auto-layout Child Properties

| Property | Figma CSS | Our serializer |
|---|---|---|
| `align-self: stretch` | `align-self: stretch` | `layoutAlign: "STRETCH"` ✅ |
| `flex-grow: 1` | `flex-grow: 1` | `layoutGrow: 1` ✅ |
| `position: absolute` | `position: absolute` | `layoutPositioning: "ABSOLUTE"` ✅ |

### 3. Effects

**LAYER_BLUR — Ellipse 227 (glow behind each card):**
```
Figma CSS:   filter: blur(112px); mix-blend-mode: hard-light;
Serializer:  effects: [{type: "LAYER_BLUR", blur: 224}], blendMode: "HARD_LIGHT"
```
The blur value and blend mode are both captured. See discrepancy note below on the blur factor.

**DROP_SHADOW — Group 532 (product logo holder):**
```
Figma CSS:   filter: drop-shadow(0px 4px 164px rgba(0, 0, 0, 0.35));
Serializer:  effects: [{type: "DROP_SHADOW", blur: 164, color: "#00000059", offsetX: 0, offsetY: 4, spread: 0}]
```
Color `#00000059` = rgba(0,0,0,0.349) ✅ matches `rgba(0,0,0,0.35)`.

### 4. Blend Mode

```
Figma CSS:   mix-blend-mode: hard-light;
Serializer:  blendMode: "HARD_LIGHT"
CSS output:  mix-blend-mode: hard-light  ✅
```

### 5. Visibility

```
Figma CSS:   display: none;          (on hidden Icon node)
Serializer:  visible: false          ✅
CSS output:  display: none           ✅
```

### 6. Per-Corner Border Radius

Node **Base** (RECTANGLE, `border-radius: 0px 20px 20px 0px` — pill-clipped badge):
```
Figma CSS:   border-radius: 0px 20px 20px 0px;
Serializer:  cornerRadius: "mixed", topLeftRadius: 0, topRightRadius: 20,
             bottomRightRadius: 20, bottomLeftRadius: 0              ✅
CSS output:  border-radius: 0px 20px 20px 0px                        ✅
```

### 7. Text Transform (textCase)

Node **Button** text:
```
Figma CSS:   text-transform: uppercase;
Serializer:  textCase: "UPPER"                                       ✅
CSS output:  text-transform: uppercase                               ✅
```

### 8. Stroke Weight & Alignment

Node **Ellipse 39** (product logo ring):
```
Figma CSS:   border: 6px solid #E5E8F0;
Serializer:  strokeWeight: 6, strokeAlign: "OUTSIDE", strokes: ["#e5e8f0"]
CSS output:  border: 6px solid #e5e8f0; box-sizing: content-box      ✅
```

### 9. IMAGE Fills

Node **_Image2_** (Atlassian logo, `CROP` fill):
```
Figma CSS:   background: linear-gradient(0deg, #FFFFFF, #FFFFFF), url(_Image2.jpg);
Serializer:  fills: [{type: "IMAGE", scaleMode: "CROP", imageHash: "eadf0af3..."}]  ✅
```
The IMAGE fill object is now captured with its hash and scaleMode.

Node **Frame 37** (4th card, Google — `FILL` image background):
```
Figma CSS:   background: url(image.png), #FFFFFF;
Serializer:  fills: ["#ffffff", {type: "IMAGE", scaleMode: "FILL", imageHash: "3f1c5068..."}]  ✅
```

### 10. Constraints in Bounds

```
Before:  bounds: {x, y, width, height}
After:   bounds: {x, y, width, height, constraints: {horizontal: "MIN", vertical: "MIN"}}  ✅
```

---

## ⚠️ Discrepancies Found

### D1 — LAYER_BLUR radius is 2× the CSS value

| | Value |
|---|---|
| Figma CSS | `filter: blur(112px)` |
| Plugin API `effect.radius` | `224` |
| Our css-converter output | `filter: blur(224px)` ❌ |

**Cause:** The Figma Plugin API returns `radius` as the full-width of the Gaussian kernel, while CSS `blur()` takes the sigma (half). The css-converter must halve the value:
```typescript
// Fix in css-converter.ts:
if (e.type === "LAYER_BLUR") filters.push(`blur(${e.blur / 2}px)`);
```

### D2 — DROP_SHADOW uses `box-shadow` instead of `filter: drop-shadow`

| | Value |
|---|---|
| Figma CSS (Group 532) | `filter: drop-shadow(0px 4px 164px rgba(0, 0, 0, 0.35))` |
| Our css-converter | `box-shadow: 0px 4px 164px 0px #00000059` ❌ |

**Cause:** `box-shadow` ignores alpha within the element and clips to the box. `filter: drop-shadow` follows the actual shape. For GROUP nodes or non-rectangular elements, `filter: drop-shadow` is semantically correct. The css-converter should use `filter: drop-shadow` for DROP_SHADOW effects, reserving `box-shadow` for INNER_SHADOW on rectangular elements.

### D3 — Noise effect type exposed unexpectedly

Frame 58 serializer output contains `effects: [{"type": "NOISE"}]`. Figma CSS does not include this. The `NOISE` effect type is an internal Figma effect that has no CSS equivalent and adds noise to the serialized output. Should be filtered out in `serializeStyles`.

### D4 — `strokeWeight` leaking on non-bordered nodes

Ellipse 227 shows `strokeWeight: 141` — a large non-zero value that does not correspond to any visible border (Figma CSS for that node has no `border`). This is an internal API artifact. The serializer should only emit `strokeWeight` when `strokes` is non-empty.

---

## ❌ Remaining Gaps (not yet captured)

### G1 — Gradient fills on Ellipse 39 missing

Node **Ellipse 39** has a gradient fill in Figma CSS:
```css
background: linear-gradient(180deg, #FFFFFF -16.5%, #EAEDF3 100%);
```
But the serializer output has no `fills` key — only `strokes`. The LINEAR_GRADIENT fill exists in Figma but is not being surfaced by `serializePaints`. Needs investigation: the fill may have `visible: false` in the Plugin API, or may be returned in a format not matched by our new gradient handler.

### G2 — Vector gradient fills: angle derivation not implemented

Figma CSS for some vector nodes:
```css
background: linear-gradient(204.45deg, #0052CC 10.91%, #2684FF 79.97%);
```
Our serializer captures `{type: "LINEAR_GRADIENT", stops: [...], transform: [[...]]}` but the `gradientTransform` 2×3 matrix is stored raw. The css-converter emits `linear-gradient(stops)` with no angle. A matrix-to-angle conversion is needed for accurate output:
```
angle = atan2(transform[0][1], transform[0][0])  (approximately)
```

### G3 — `position: absolute` with correct `left/top` not derived

Figma CSS:
```css
position: absolute;
left: -72px;
top: 352.59px;
```
Our serializer has `layoutPositioning: "ABSOLUTE"` and page-absolute `bounds.x/y`. The css-converter outputs neither `position: absolute` nor the correct `left/top` (which would require subtracting the parent's origin). This needs parent-relative coordinate resolution.

### G4 — `isolation: isolate` not captured

Figma CSS includes `isolation: isolate` on Frame 37 nodes. This property is set by Figma when a frame creates a stacking context (due to `z-index` children or blend modes). There is no direct Plugin API property for this; it would need to be inferred from child blendModes.

### G5 — `z-index` and flex `order` not present

Figma CSS emits `z-index: 0/1/2` for absolute children and `order: 0/1/2` for flex children. Neither is in the Plugin API directly — both must be derived from the node's position in `node.parent.children`. Not critical for most use cases but affects rendering accuracy.

### G6 — `transform: matrix(...)` for rotated/mirrored nodes

Several nodes (Group 6273229 — the reversed arrow button) have:
```css
transform: matrix(-1, 0, 0, 1, 0, 0);
```
The serializer doesn't capture `node.rotation` or the transform matrix. Figma Plugin API exposes `node.rotation` (degrees) but not the full matrix.

### G7 — `get_css` tool not registered in running server

The `get_css` MCP tool was added to `internal/tools_read_document.go` but is absent from the deferred tools list, meaning the running server compiled from a version of the source that predates the change. Verify `go run` is picking up the latest source and restart if needed.

---

## Summary

| Category | Status |
|---|---|
| Auto-layout (flex container + child props) | ✅ Fully working |
| Effects: LAYER_BLUR + DROP_SHADOW | ✅ Captured — **2× blur bug** in css-converter |
| Blend mode | ✅ Working |
| Visibility | ✅ Working |
| Per-corner radii | ✅ Working |
| textCase → text-transform | ✅ Working |
| Stroke weight + alignment | ✅ Working |
| IMAGE fills | ✅ Working |
| Constraints in bounds | ✅ Working |
| Gradient fills (LINEAR_GRADIENT) | ⚠️ Partial — missing on some nodes (Ellipse 39) |
| DROP_SHADOW CSS type | ⚠️ Should be `filter: drop-shadow`, not `box-shadow` |
| NOISE effect leaking | ⚠️ Should be filtered out |
| Stray strokeWeight on no-border nodes | ⚠️ Should be gated on `strokes` presence |
| Gradient angle from transform matrix | ❌ Not implemented |
| `position: absolute` with left/top | ❌ Not implemented (needs parent-relative coords) |
| `isolation: isolate` | ❌ No API equivalent |
| `z-index` / flex `order` | ❌ Must derive from child index |
| Node rotation / transform matrix | ❌ Not captured |
| `get_css` tool | ❌ Not active in running server |
