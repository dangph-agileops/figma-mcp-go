const BLEND_MODE: Record<string, string> = {
  MULTIPLY: "multiply",
  SCREEN: "screen",
  OVERLAY: "overlay",
  DARKEN: "darken",
  LIGHTEN: "lighten",
  COLOR_DODGE: "color-dodge",
  COLOR_BURN: "color-burn",
  HARD_LIGHT: "hard-light",
  SOFT_LIGHT: "soft-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
};

const FLEX_DIRECTION: Record<string, string> = { HORIZONTAL: "row", VERTICAL: "column" };
const JUSTIFY_CONTENT: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};
const ALIGN_ITEMS: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
};
const TEXT_TRANSFORM: Record<string, string> = {
  UPPER: "uppercase",
  LOWER: "lowercase",
  TITLE: "capitalize",
};

export function nodeToCss(n: any): string {
  const s = n.styles ?? {};
  const b = n.bounds ?? {};
  const ln: string[] = [];

  if (b.width != null) ln.push(`width: ${b.width}px`);
  if (b.height != null) ln.push(`height: ${b.height}px`);

  // TEXT fills are text color, not background — handled in the typography block below
  if (n.type !== "TEXT" && Array.isArray(s.fills)) {
    const bgs = s.fills.map(fillToCss).filter(Boolean) as string[];
    if (bgs.length) ln.push(`background: ${bgs.join(", ")}`);
  }

  if (Array.isArray(s.strokes) && s.strokes.length > 0) {
    const color = typeof s.strokes[0] === "string" ? s.strokes[0] : "#000000";
    const w = s.strokeWeight ?? 1;
    ln.push(`border: ${w}px solid ${color}`);
    if (s.strokeAlign === "OUTSIDE") ln.push(`box-sizing: content-box`);
  }

  if (s.topLeftRadius !== undefined) {
    ln.push(
      `border-radius: ${s.topLeftRadius}px ${s.topRightRadius}px ` +
        `${s.bottomRightRadius}px ${s.bottomLeftRadius}px`,
    );
  } else if (s.cornerRadius && s.cornerRadius !== "mixed") {
    ln.push(`border-radius: ${s.cornerRadius}px`);
  }

  if (s.opacity != null) ln.push(`opacity: ${s.opacity}`);

  if (s.visible === false) ln.push(`display: none`);

  if (s.blendMode && BLEND_MODE[s.blendMode]) {
    ln.push(`mix-blend-mode: ${BLEND_MODE[s.blendMode]}`);
  }

  // G4: isolation creates a stacking context when children have non-default blend modes
  if (s.isolate) ln.push(`isolation: isolate`);

  if (Array.isArray(s.effects) && s.effects.length > 0) {
    const filters: string[] = [];
    const dropShadows: string[] = [];
    const innerShadows: string[] = [];
    let backdrop = "";
    for (const e of s.effects) {
      // D1 fix: Plugin API radius = 2× CSS blur sigma — halve it
      if (e.type === "LAYER_BLUR") filters.push(`blur(${e.blur / 2}px)`);
      if (e.type === "BACKGROUND_BLUR") backdrop = `backdrop-filter: blur(${e.blur / 2}px)`;
      // D2 fix: DROP_SHADOW → filter:drop-shadow (shape-aware); INNER_SHADOW → box-shadow inset
      if (e.type === "DROP_SHADOW")
        dropShadows.push(`drop-shadow(${e.offsetX}px ${e.offsetY}px ${e.blur}px ${e.color})`);
      if (e.type === "INNER_SHADOW")
        innerShadows.push(
          `inset ${e.offsetX}px ${e.offsetY}px ${e.blur}px ${e.spread ?? 0}px ${e.color}`,
        );
    }
    const allFilters = [...filters, ...dropShadows];
    if (allFilters.length) ln.push(`filter: ${allFilters.join(" ")}`);
    if (innerShadows.length) ln.push(`box-shadow: ${innerShadows.join(", ")}`);
    if (backdrop) ln.push(backdrop);
  }

  if (s.layoutMode && s.visible !== false) {
    ln.push(`display: flex`);
    ln.push(`flex-direction: ${FLEX_DIRECTION[s.layoutMode] ?? "row"}`);
    if (s.primaryAxisAlignItems && s.primaryAxisAlignItems !== "MIN")
      ln.push(`justify-content: ${JUSTIFY_CONTENT[s.primaryAxisAlignItems] ?? "flex-start"}`);
    if (s.counterAxisAlignItems)
      ln.push(`align-items: ${ALIGN_ITEMS[s.counterAxisAlignItems] ?? "flex-start"}`);
    if (s.itemSpacing) ln.push(`gap: ${s.itemSpacing}px`);
    if (s.clipsContent) ln.push(`overflow: hidden`);
  }

  if (s.padding) {
    const { top, right, bottom, left } = s.padding;
    let p: string;
    if (top === right && right === bottom && bottom === left) p = `${top}px`;
    else if (top === bottom && left === right) p = `${top}px ${right}px`;
    else p = `${top}px ${right}px ${bottom}px ${left}px`;
    ln.push(`padding: ${p}`);
  }

  // G3: absolute positioning with parent-relative left/top from bounds (node.x/y is parent-relative)
  if (s.layoutPositioning === "ABSOLUTE") {
    ln.push(`position: absolute`);
    if (b.x != null) ln.push(`left: ${b.x}px`);
    if (b.y != null) ln.push(`top: ${b.y}px`);
  }

  if (n.type === "TEXT") {
    if (s.fontFamily) ln.push(`font-family: '${s.fontFamily}', sans-serif`);
    if (s.fontSize) ln.push(`font-size: ${s.fontSize}px`);
    if (s.fontWeight) ln.push(`font-weight: ${s.fontWeight}`);
    if (s.lineHeight?.unit === "PERCENT") ln.push(`line-height: ${s.lineHeight.value}%`);
    if (s.lineHeight?.unit === "PIXELS") ln.push(`line-height: ${s.lineHeight.value}px`);
    // Letter-spacing fix: PERCENT in Figma = % of font size → divide by 100 for em
    if (s.letterSpacing?.value) {
      const ls =
        s.letterSpacing.unit === "PERCENT"
          ? `${+(s.letterSpacing.value / 100).toFixed(4)}em`
          : `${s.letterSpacing.value}px`;
      ln.push(`letter-spacing: ${ls}`);
    }
    if (s.textAlignHorizontal) ln.push(`text-align: ${s.textAlignHorizontal.toLowerCase()}`);
    if (s.textCase && TEXT_TRANSFORM[s.textCase])
      ln.push(`text-transform: ${TEXT_TRANSFORM[s.textCase]}`);
    if (Array.isArray(s.fills) && typeof s.fills[0] === "string") ln.push(`color: ${s.fills[0]}`);
  }

  if (s.layoutAlign === "STRETCH") ln.push(`align-self: stretch`);
  if (s.layoutGrow === 1) ln.push(`flex-grow: 1`);

  // G6: rotation — Figma rotation is clockwise degrees, same convention as CSS rotate()
  if (s.rotation != null && s.rotation !== 0) {
    ln.push(`transform: rotate(${s.rotation}deg)`);
  }

  // G5: z-index for absolute children; order for flex children (skip when value is 0)
  if (n._order !== undefined && n._order > 0) {
    if (s.layoutPositioning === "ABSOLUTE") ln.push(`z-index: ${n._order}`);
    else ln.push(`order: ${n._order}`);
  }

  return ln.map((l) => `  ${l};`).join("\n");
}

function fillToCss(fill: any): string | undefined {
  if (typeof fill === "string") return fill;
  if (!fill?.type) return undefined;

  if (fill.type === "LINEAR_GRADIENT" && Array.isArray(fill.stops)) {
    // G2: derive CSS angle from Figma's 2×3 gradientTransform matrix
    // The canonical gradient direction is (1,0) in gradient space.
    // After transform [[a,b,tx],[c,d,ty]], the direction vector in node space is [a, c].
    // CSS angle from top (0deg=up, 90deg=right): atan2(a, -c)
    let angle = 180; // default: top-to-bottom
    if (Array.isArray(fill.transform) && fill.transform.length === 2) {
      const a = fill.transform[0][0];
      const c = fill.transform[1][0];
      angle = Math.round(((Math.atan2(a, -c) * 180) / Math.PI + 360) % 360);
    }
    const stops = fill.stops
      .map((s: any) => `${s.color} ${Math.round(s.position * 100)}%`)
      .join(", ");
    return `linear-gradient(${angle}deg, ${stops})`;
  }

  if (fill.type === "RADIAL_GRADIENT" && Array.isArray(fill.stops)) {
    const stops = fill.stops
      .map((s: any) => `${s.color} ${Math.round(s.position * 100)}%`)
      .join(", ");
    return `radial-gradient(${stops})`;
  }

  if (
    (fill.type === "ANGULAR_GRADIENT" || fill.type === "DIAMOND_GRADIENT") &&
    Array.isArray(fill.stops)
  ) {
    const stops = fill.stops
      .map((s: any) => `${s.color} ${Math.round(s.position * 100)}%`)
      .join(", ");
    return `conic-gradient(${stops})`;
  }

  return undefined;
}
