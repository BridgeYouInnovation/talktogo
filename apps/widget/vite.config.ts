import { defineConfig } from "vite";

// Builds the embeddable widget as a single self-contained IIFE file.
// Websites load it with:
//   <script src="https://your-app/widget.js" data-site-id="..." async></script>
export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      name: "TalkToGo",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
  },
  envDir: "../..",
});
