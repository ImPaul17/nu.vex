# Branding and font provenance

Inspected for the phase 0/1 milestone on 19 October 2026. The supplied artwork is the official nu.vex identity. It is used as provided, without replacing its design, redrawing it with a font, or recoloring it to match theme preferences.

## Asset inventory and intended use

Filenames alone do not describe the contents: `logo-app.svg` is a wide wordmark, while `logo-app.png` is a square application icon.

| Supplied file | Inspected geometry/content | Use |
| --- | --- | --- |
| `logo-app.png` | 1000 × 1000; finished emerald glass application icon with transparency | App identity, navigation, native icon source |
| `logo-app.svg` | 1500 × 312; full pixel-art wordmark represented by paths | Preferred scalable wordmark |
| `logo-1.png` | 1500 × 312; wide raster lockup with pale artwork and mint symbol, transparent pixels | Raster alternative; inspect on a dark surface |
| `logo-2.png` | 1000 × 847; pale symbol with transparency | Compact symbol where the full wordmark does not fit |
| `logo-2.svg` | 1000 × 847; same pale pixel symbol represented by paths | Preferred scalable compact symbol |
| `logo-app.psd`, `logo-1.psd`, `logo-2.psd` | Supplied editable source files, inventoried but not parsed or exported in this milestone | Preserve as source artwork |

Both SVGs contain path geometry rather than a live text/font dependency. The wide SVG declares `#E5FDF7` for its pale artwork and `#10D192` for the mint symbol; the symbol SVG declares `#E5FDF7`. Interface text uses the pale brand color; the initial UI accent remains the suggested `#14D392`. Theme customization changes interface tokens, not the colors embedded in the official logos.

### Transparency verification

PNG dimensions and alpha were inspected with `System.Drawing`. A light preview can hide the pale portion of a logo, so the preview background must not be mistaken for the source pixels.

| PNG | Fully transparent pixels | Partially transparent pixels | Opaque pixels |
| --- | ---: | ---: | ---: |
| `logo-app.png` | 49,971 | 17,295 | 932,734 |
| `logo-1.png` | 300,322 | 8,292 | 159,386 |
| `logo-2.png` | 530,474 | 5,206 | 311,320 |

Among pixels with nonzero alpha, `logo-1.png` contains 140,597 pixels of `#E5FDF7` and 27,081 of `#10D192`. The visible pixels of `logo-2.png` are all `#E5FDF7`. RGB values stored in fully transparent pixels do not indicate visible background color.

All eight root files remain the source assets. The five SVG/PNG files are copied into `apps/web/static/brand`; each copy was checked to have the same SHA-256 as its root original:

```text
logo-app.svg  F5E5A06F25B7EEEDD8A37C0AF7A2FBBEE6C726CE27D32460C8269EC2D1470600
logo-app.png  0DF7617A475B91AB4D3F8039010880BB1DDFC20A46CF71AF7DF2D7F6D326B181
logo-1.png    3629D00099C60FC9FBBC002B7A3B1561417DC3B17C0F185D53B1CABC92B1DD82
logo-2.png    DB257025AFFAB7A4FE4297986DAC92C021A4F768F74974F3B8D624E3EB697C8A
logo-2.svg    72FE41E902B46DE57F44B9FE80555790323FB0772B641401D415CC2FE8FBA2D7
```

Preserve aspect ratio, transparency, and pixel geometry. Do not apply CSS filters, stretch, crop, or reconstruct the wordmark with ordinary text. Native packaging derivatives and their current limitations are documented in [desktop](desktop.md).

## Typography

The initial repository supplied no font files. Two fonts were subsequently vendored from the official `geist` npm package, version **1.8.1**, rather than installing its framework integration as an application dependency:

| Distributed file | Role | SHA-256 |
| --- | --- | --- |
| `apps/web/static/fonts/Geist-Variable.woff2` | Readable body/UI text; variable weight 100–900 | `9CE2D97863CAB59A0C7522534112D6C42A4E25C0E6B2AB37766761B0F82CFBD6` |
| `apps/web/static/fonts/GeistPixel-Square.woff2` | Vendored optional pixel font; retained for provenance, not the current UI heading font | `80887AFEDE26BC861E92DBFBB17A775D769E46E7C84F336B1C9F17959F60606D` |

The files and the accompanying `LICENSE.txt` were checked against the extracted package copies without modification. The package notice identifies SIL Open Font License 1.1; the [upstream Geist license](https://github.com/vercel/geist-font/blob/main/OFL.txt) also identifies OFL 1.1. Keep the [distributed package notice](../apps/web/static/fonts/LICENSE.txt) with the fonts. That notice is the one accompanying this exact package version; current upstream copyright wording may differ.

`packages/tokens/theme.css` declares local font URLs with `font-display: swap` and system fallbacks. The current interface uses readable Geist for text and headings, following the owner's typography preference; the optional pixel font file remains vendored without being the active heading face. The client does not fetch fonts from an external runtime service. The supplied pixel-art wordmark remains the original SVG artwork, independent of the interface fonts.

## License and brand identity

The fonts' OFL license is distinct from the approved [Apache-2.0 project license](licensing.md). Preserve the supplied artwork when presenting the official identity. Apache-2.0 and the project NOTICE do not grant trademark rights or imply endorsement of a derivative project.
