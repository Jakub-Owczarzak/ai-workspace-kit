# figma-sync recipes

Learned while building 40+ frames in one project. Read before the first write of a session.

## Order of work

1. `create_session` for the target file, then read it (`get_metadata` for pages, then `use_figma`
   read-only scripts). Big pages return huge output: ask for IDs, names and sizes only.
2. Load the Figma skills, then check for a variable collection. Without one, create it first.
3. Build frames, screenshot, fix, screenshot once more. Take at most one screenshot per frame after
   the build and one after a fix.
4. Record IDs in the project file as soon as a frame exists.

## Pitfalls (each one happened)

- `node.resize(w, h)` resets the sizing mode to FIXED. Call it first, then set
  `primaryAxisSizingMode` / `counterAxisSizingMode` (use `'AUTO'` to hug). Symptom: a field collapses
  to a thin line or its label is cut off.
- A wrapping text needs `textAutoResize = 'HEIGHT'` and `layoutSizingHorizontal = 'FILL'` set AFTER it
  is appended to an auto-layout parent. Check `width > 1` for every text after the build.
- `figma.createAutoLayout()` frames and `createFrame()` have a default white fill. Set `fills = []`
  for transparent boxes (a "Cancel" button came out white in dark mode).
- A card's inner width is its width minus its padding AND its border (an off-by-2 clipped a field).
  Let one child FILL the row instead of fixing every width.
- Rows that wrap (chips) use `layoutWrap = 'WRAP'` plus `counterAxisSpacing`.
- Individual border sides: `strokeTopWeight`, `strokeBottomWeight`, `strokeLeftWeight`,
  `strokeRightWeight`.
- A node cloned from another frame keeps its own colors; wrapping it in a frame that has a variable
  mode only changes layers bound to variables.
- `figma.currentPage` cannot be set. Use `await figma.setCurrentPageAsync(page)`, once per call.
  Page context resets at the start of every call.
- Run write calls one after another, never in parallel. Read-only calls on different pages can run in
  parallel (one per page).
- Fonts must be loaded before any text write (`loadFontAsync`) and style names checked
  (`"Semi Bold"` not `"SemiBold"`).
- Colors are 0 to 1. Paint colors have no `a`; opacity is on the paint.
- Icons: import the SVG with `figma.createNodeFromSvg` (give it width, height and viewBox), resize it,
  and bind the vector strokes to a variable. Never rebuild an icon from rotated lines.
- Cross-file copy, restore and undo are not possible through the plugin API. The user does these in
  Figma (copy and paste, version history).

## Frames

- Name: `Screen / State / Mode / Width`, for example `Checkout / Order confirmation / Dark / 360`.
- One frame per mode, each setting its own mode:
  `frame.setExplicitVariableModeForCollection(collection, modeId)`. Fill, stroke and text colors are
  bound with `figma.variables.setBoundVariableForPaint(paint, 'color', variable)`.
- A screen with a dimmed background (dialog) uses two fills on the frame: the page color, then the
  scrim color.
- Several states in one frame: a vertical auto-layout frame with a small uppercase caption above each
  state.
- Place new frames to the right of the existing ones on the same page (compute the right edge, add a
  gap), light row on top, dark row below.
- Idempotence: before building, check that no frame with the planned name exists, and return IDs.

## Variables

- Collection per project, modes = color schemes. Names equal the palette keys in code
  (`color/surface`, `signal/danger/fg`, `brand/acid`) so a script can compare code and Figma.
- Scopes on every variable (text colors `TEXT_FILL`, surfaces `FRAME_FILL`/`SHAPE_FILL`, borders
  `STROKE_COLOR`). Never leave `ALL_SCOPES`.
- Semi-transparent colors keep their alpha in the variable value.

## Verify: contrast scan (read-only, run per page)

Compares every text layer with its effective background in its mode (stacked fills and alpha
composited) and returns the failing pairs. Edit `PAGE_ID`, `PREFIXES` and `COLLECTION`.

```js
const PAGE_ID = '1:3', PREFIXES = ['Create /'], COLLECTION = 'My Color';
const page = await figma.getNodeByIdAsync(PAGE_ID); await figma.setCurrentPageAsync(page);
const collection = (await figma.variables.getLocalVariableCollectionsAsync()).find(c => c.name === COLLECTION);
const modeId = {}; for (const m of collection.modes) modeId[m.name] = m.modeId;
const cache = {};
const colorOf = async (paint, mode) => {
  if (paint.type !== 'SOLID' || paint.visible === false) return null;
  let c = paint.color, a = paint.opacity === undefined ? 1 : paint.opacity;
  const bound = paint.boundVariables && paint.boundVariables.color;
  if (bound) { cache[bound.id] = cache[bound.id] || await figma.variables.getVariableByIdAsync(bound.id);
    const v = cache[bound.id].valuesByMode[modeId[mode]]; c = v; a = (v.a === undefined ? 1 : v.a) * a; }
  return { r: c.r, g: c.g, b: c.b, a };
};
const over = (t, b) => { const a = t.a + b.a * (1 - t.a); return { r: (t.r*t.a + b.r*b.a*(1-t.a))/a, g: (t.g*t.a + b.g*b.a*(1-t.a))/a, b: (t.b*t.a + b.b*b.a*(1-t.a))/a, a }; };
const lum = c => { const f = v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi+0.05)/(lo+0.05); };
const hex = c => '#' + [c.r,c.g,c.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
const skip = n => { for (let p = n; p; p = p.parent) if (p.name === 'Annotation') return true; return false; };
const found = {}; let scanned = 0, lowest = 99;
for (const root of page.children.filter(n => PREFIXES.some(p => n.name.startsWith(p)))) {
  const mode = Object.keys(modeId).find(m => root.name.includes(` / ${m} /`)) || Object.keys(modeId)[0];
  for (const t of root.findAll(n => n.type === 'TEXT')) {
    if (skip(t)) continue;
    const chain = []; for (let p = t.parent; p && p.type !== 'PAGE'; p = p.parent) chain.unshift(p);
    let bg = { r: 1, g: 1, b: 1, a: 1 };
    for (const anc of chain) for (const f of (Array.isArray(anc.fills) ? anc.fills : [])) { const c = await colorOf(f, mode); if (c) bg = over(c, bg); }
    const fg0 = await colorOf(t.fills[0], mode); if (!fg0) continue;
    const fg = over(fg0, bg), r = ratio(fg, bg); scanned++; lowest = Math.min(lowest, r);
    const key = `${mode}|${hex(fg)}|${hex(bg)}|${t.fontSize}`;
    found[key] = found[key] || { mode, fg: hex(fg), bg: hex(bg), size: t.fontSize, ratio: Math.round(r*100)/100, count: 0, example: t.characters.slice(0, 30), frame: root.name };
    found[key].count++;
  }
}
return { scanned, lowest: Math.round(lowest*100)/100, failing: Object.values(found).filter(x => x.ratio < 4.5).sort((a, b) => a.ratio - b.ratio) };
```

Disabled controls are exempt from the 4.5:1 rule; a failure on a disabled label is not a defect.
If a role in the palette fails everywhere, the palette is at fault: report it, do not "fix" each frame.
