# Axorbis documentation website

This Astro project builds the public documentation site. It is separate from the product interface in [`../web/`](../web/) and the desktop host in [`../app/`](../app/).

```bash
npm ci --prefix website
npm run build --prefix website
```

Documentation pages live in `src/content/docs/`; shared assets are in `public/`. The build output is `dist/`. See the root [README](../README.md) for the runnable research workspace and [docs index](../docs/README.md) for project documents.
