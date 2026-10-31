# Wiki Viewer for Paseo

A [Paseo](https://paseo.sh) plugin that shows a workspace in [wiki-viewer](https://www.npmjs.com/package/wiki-viewer) inside the Explorer sidebar, and opens files from chat and the file tree in a Wiki Viewer file tab. See [OVERVIEW.md](OVERVIEW.md) for what it does, its settings, and its limits.

## Install

```bash
paseo plugin install npm:paseo-wiki-viewer
```

Or from source:

```bash
paseo plugin install github:anh-chu/paseo-wiki-viewer
```

Then open **Wiki Viewer** from the Command Center (Ctrl+K or ⌘K) and press **Install wiki-viewer** once.

Requirements on the daemon machine: Paseo 0.13.0 or newer, and `npm` and `tar` for the viewer install.

## Develop

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload wiki-viewer
```

The plugin is a port of `dsh-wiki-viewer` from [anh-chu/dsh-plugins](https://github.com/anh-chu/dsh-plugins).

## License

MIT
