# Cartographer — Visual & Technical Asset Style Guide (`asset-style-guide.md`)

## 1. Camera & Projection
- **Strict 90° Top-Down Orthographic**: All ground textures, road surfaces, castle wall caps, decals, roofs, foliage, furniture, traps, and newly integrated urban props use a vertical bird's-eye orthographic plan view (`90°`).
- **No Baked Perspective Distortion on Materials**: Surface textures (`terrain`, `road_*`, `castle_wall_*`, `mat*`) show pure flat top surfaces without foreshortening, horizon lines, or side walls.

## 2. Lighting, Palette & Outlines
- **Light Direction**: Gentle upper-left (`NW`) ambient daylight beveling on stone joints, planks, and reliefs; **never** bake long external drop shadows into sprites or textures (`render.ts` and `settlementPaint.ts` compute dynamic shadows according to `RenderSettings.shading`).
- **No Baked Glow on Daytime Props**: Lanterns, braziers, torches, candles, and glass vials depict unlit/physical glass, metal, and wax only; illumination halos are rendered dynamically by `drawUrbanLightingPass` (`dusk`/`night`) and `cryptPainter.lights()`.
- **Palette & Contrast**: Warm, grounded medieval natural pigments — weathered limestone greys, warm ochre/earth browns, muted slate blues, desaturated terracotta reds, and olive-moss greens. Avoid neon saturation or harsh pure `#000000` / `#FFFFFF` extremes.
- **Outlines**:
  - **Standalone Props & Attachments**: Crisp `1.5–2.5 px` dark umber-charcoal (`#2b231c`) outer ink contour with finer internal detail lines.
  - **Ground Decals & Wear Overlays**: Soft irregular feathered alpha transitions (`0` hard rectangular frame, `0` thick outer black stroke).
  - **Seamless Surface Materials**: Painterly stone/earth/mortar transitions (`#3a332a` recessed joints, subtle bevel highlights), **never** heavy comic-book black grids around every stone.

## 3. Technical Specifications
- **Seamless Road & Fortification Source Textures**: `1024×1024` RGB PNG in `assets/source/{roads,walls}/`, converted to seamless `768×768` high-quality WebP (`q=92`) in `src/assets/cartography/` for optimal single-file HTML bundle size and crisp 200% Retina zoom.
- **Tileability**: Exact periodic wrap (`left ↔ right`, `top ↔ bottom`) verified via Efros-Freeman minimum-error seam quilting and `3×3` repeatability checks (`seamLR` and `seamTB` matching interior gradient).
- **World-Space Continuity**: Road `CanvasPattern`s and `terrainPaint.ts` UVs must remain continuous in world coordinates across cell boundaries, bends, and intersections — never restarting at individual grid cells.
- **Longitudinal Wall Alignment**: `castle_wall_*.webp` stone courses run horizontally (`+X`) so tangent-aligned wall ribbon segments carry masonry joints naturally along horizontal, vertical, and curved fortification arcs without stretching across `RenderSettings.wallThickness`.
- **Sprite Alpha Hygiene**: Edge-connected flood-fill + white-matte unmixing (`clean-sprite-edges.py`); never apply destructive global white thresholding that erases pale stone, parchment, salt, or specular metal highlights.
