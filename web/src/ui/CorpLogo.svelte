<script lang="ts">
  // A player corporation's logo, as eveIcon.CorpIcon draws it (DoLayout, SetLayerShapeAndColor): three layers, each
  // a shape of the client's logo library (graphicCorpLogoLibShapes; the library's "no shape" for one it has not) in a
  // colour (graphicCorpLogoLibColors, CORPLOGO_DEFAULT_COLOR for none) by the colour's blend:
  //
  //   blend     the shape's texture times the colour (TR2_SFX_COPY)
  //   solid     the colour, where the shape is (fill.dds masked by the shape: TR2_SFX_MASK)
  //   gradient  the colour's own texture (corpLogoLibs/<colorID>.png), where the shape is
  //
  // The first layer is in front, as carbonui draws a container's first child over the rest. A layer with no shape is
  // not drawn. A colour channel above 1 (the library's brighter blues and oranges) is drawn at 1: a page cannot light
  // a texture past white.
  import type { CorpLogoData, CorpLogoLibrary } from "../app/api.ts";
  import { clientTexture } from "./skillGroupIcons.ts";

  let { library, logo, name }: { library: CorpLogoLibrary; logo: CorpLogoData; name: string } = $props();

  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  const layers = $derived.by(() => {
    const out: { key: number; style: string }[] = [];
    for (const at of [2, 1, 0]) {
      const shapeID = logo.shapes[at] ?? null;
      if (shapeID === null) continue;
      const shape = clientTexture(library.shapes[String(shapeID)] ?? library.shapes[String(library.noShape)] ?? "");
      const colorID = logo.colors[at] ?? null;
      const color = (colorID === null ? undefined : library.colors[String(colorID)]) ?? library.defaultColor;
      const [r, g, b, a] = color.rgba;
      const rgb = `rgb(${channel(r!)}, ${channel(g!)}, ${channel(b!)})`;
      const mask = `mask-image: url("${shape}"); -webkit-mask-image: url("${shape}");`;
      const style =
        color.blend === library.blends.gradient && colorID !== null
          ? `background-image: url("${clientTexture(`res:/UI/Texture/corpLogoLibs/${colorID}.png`)}"); ${mask}`
          : color.blend === library.blends.solid
            ? `background-color: ${rgb}; opacity: ${a}; ${mask}`
            : `background-image: url("${shape}"); background-color: ${rgb}; background-blend-mode: multiply; opacity: ${a}; ${mask}`;
      out.push({ key: at, style });
    }
    return out;
  });
</script>

<span class="corp-logo" role="img" aria-label={name}>
  {#each layers as layer (layer.key)}
    <span class="corp-logo-layer" style={layer.style}></span>
  {/each}
</span>
