# Prince Rupert's Teardrops

Interactive residual-stress and fracture demo for Prince Rupert's teardrops.

This project explains why the bulb of a Prince Rupert's teardrop can survive heavy compression while a small crack at the tail can trigger catastrophic fracture. It is meant as a browser-based teaching artifact: visual first, scientifically grounded, and easy to open locally.

## What This Demonstrates

- Residual stress intuition through interactive visuals.
- A contrast between the compressed outer shell and tensile interior.
- Why crack location matters more than simple "strong versus fragile" framing.
- A lightweight web-explainer workflow using Vite and static assets.

## Project Structure

- `app/` - source app entry.
- `artifacts/` - generated diagrams and explanatory images.
- `assets/` - built static assets.
- `index.html` - GitHub Pages entry point.

## Local Development

```bash
npm install
npm run dev
```

Then open `http://127.0.0.1:5173/`.

## Static Build

```bash
npm run build
```

The build writes the GitHub Pages entry files into this folder root, so the demo is available at `/prince-ruperts-teardrops/`.
