# Decisions Browser campaign creative

Seven final PNGs, their editable HTML sources, and a four-page LinkedIn document. Open `index.html` for the image gallery or `decisions-browser-carousel.pdf` for the document carousel.

- `01-youtube-thumbnail.png`: 1280 × 720.
- `02-linkedin-landscape.png`: 1200 × 627.
- `03-square.png`: 1080 × 1080.
- `04-carousel-01-hook.png` through `07-carousel-04-cta.png`: four 1080 × 1350 slides, in order.

The timing headline is scoped to one recorded local browser workflow. Models were not matched and the control paths differ; the Windows run included input recovery. Setup is excluded. These assets present a harness case study, not a universal speed claim.

The proof images in `assets/` are unchanged captures from the demonstration. The carousel PDF uses the four slide HTML sources and preserves selectable text. No personal browser material or synthetic UI is included.

Reproduce from the repository root with `node scripts/render-campaign.mjs`, then `node scripts/render-campaign.mjs --pdf-only`. The PNG renderer checks dimensions and content bounds. `render-checks.json` records the final image checks; `pdf-checks.json` records PDF page count, sizing, selectable content, and path checks. Review tours and rendered PDF QA pages live in ignored `artifacts/campaign/creative-review/`.

Design: a restrained editorial system in warm ivory, ink, cobalt, and mint. Large timing typography leads to the evidence, then the bounded-loop architecture, then the open-source and Bill Moore offers.

Source repository: https://github.com/chickensintrees/decisions-browser
