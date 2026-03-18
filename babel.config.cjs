// Custom plugin: replace Vite's `import.meta.env.DEV` → `false` for Jest
function viteImportMetaEnv() {
  return {
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        // import.meta.env.DEV → false, import.meta.env.PROD → true
        if (
          node.object?.type === "MemberExpression" &&
          node.object.object?.type === "MetaProperty" &&
          node.object.property?.name === "env"
        ) {
          if (node.property?.name === "DEV") {
            path.replaceWith({ type: "BooleanLiteral", value: false });
          } else if (node.property?.name === "PROD") {
            path.replaceWith({ type: "BooleanLiteral", value: true });
          }
        }
      },
      MetaProperty(path) {
        // import.meta.url → require("url").pathToFileURL(__filename).toString()
        if (path.parent.type === "MemberExpression" && path.parent.property?.name === "url") {
          return; // handled by babel-plugin-transform-import-meta
        }
      },
    },
  };
}

module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
  plugins: [viteImportMetaEnv, "babel-plugin-transform-import-meta"],
};
