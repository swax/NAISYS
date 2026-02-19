/** Enforces that relative imports include an explicit .js extension.
 *  This prevents runtime errors in Node.js ESM where extensionless imports fail. */
export default {
  create: function (context) {
    function check(node) {
      const source = node.source;
      if (!source) return;

      const value = source.value;
      if (!value.startsWith("./") && !value.startsWith("../")) return;

      // Allow .js, .json, and other explicit extensions
      if (/\.\w+$/.test(value)) return;

      context.report({
        node: source,
        message: `Relative import '${value}' is missing a .js extension. Node.js ESM requires explicit extensions.`,
      });
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};
