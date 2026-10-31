import type { PluginClientContext, PluginFilePanelProps } from "@getpaseo/plugin/client";
import { WikiFilePanel } from "./client/file-panel";
import { requestOpen } from "./client/open-requests";
import { WikiPanel } from "./client/panel";
import { WikiSettings } from "./client/settings";

// Paseo matches file panels by extension or exact filename only, with no wildcard,
// so this lists everything wiki-viewer renders: documents, media, data and code.
const WIKI_EXTENSIONS = [
  "md", "markdown", "mdx", "txt", "log", "ipynb", "mmd", "mermaid", "html", "htm",
  "pdf", "docx", "xlsx", "pptx", "csv", "tsv",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
  "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "flac",
  "json", "jsonc", "jsonl", "yaml", "yml", "toml", "ini", "env", "xml", "lock",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "css", "scss", "less", "vue", "svelte", "astro",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "lua", "dart", "scala", "ex", "exs", "erl", "hs", "clj", "r", "jl", "zig", "nim",
  "sh", "bash", "zsh", "fish", "ps1", "sql", "graphql", "gql", "proto", "tf", "hcl", "nix", "groovy", "gradle",
  // Binaries: Paseo has no preview for these, and wiki-viewer offers a download.
  "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "war", "whl", "apk", "ipa", "deb", "rpm", "dmg", "iso", "img",
  "exe", "msi", "dll", "so", "dylib", "bin", "o", "a", "wasm", "class", "pyc",
  "sqlite", "sqlite3", "db", "parquet", "arrow", "avro", "pkl", "npy", "npz", "h5", "onnx", "pt", "safetensors",
  "doc", "xls", "ppt", "odt", "ods", "odp", "rtf", "epub", "key", "numbers", "pages",
  "heic", "tif", "tiff", "psd", "ai", "eps", "sketch", "fig", "mkv", "avi", "wmv", "aac", "opus",
  "ttf", "otf", "woff", "woff2", "eot",
];
const WIKI_FILENAMES = ["Dockerfile", "Makefile", "Justfile", "justfile", "LICENSE", "Procfile", "Gemfile", "Rakefile", ".gitignore", ".dockerignore", ".editorconfig", ".npmrc"];

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "wiki",
    title: "Wiki Viewer",
    icon: "BookOpen",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: WikiPanel,
  });
  client.addCommandCenterItem({
    id: "open-wiki",
    title: "Open Wiki Viewer",
    icon: "BookOpen",
    keywords: ["wiki", "markdown", "files", "docs"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("wiki", { location: "explorer" });
    },
  });
  client.addSettingsScreen({ id: "viewer", title: "Wiki Viewer", icon: "BookOpen", Component: WikiSettings });
  // Files opened from chat or the file tree show here once picked in Paseo's
  // picker, Open with, or Settings > Files. Paseo removes registrations on unload.
  client.addFilePanel({
    id: "wiki-file",
    title: "Wiki Viewer",
    icon: "BookOpen",
    files: { extensions: WIKI_EXTENSIONS, filenames: WIKI_FILENAMES },
    Component: (props: PluginFilePanelProps) => (
      <WikiFilePanel
        {...props}
        showInSidebar={(url) => {
          requestOpen(props.workspaceId, url);
          client.openPanel("wiki", { workspaceId: props.workspaceId, location: "explorer" });
        }}
      />
    ),
  });
  return () => {};
}
