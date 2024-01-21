module.exports = {
  create: function (context) {
    return {
      ImportDeclaration: function (node) {
        if (node.source.value.endsWith(".js")) {
          const filename = node.source.value
            .split("/")
            .pop()
            .replace(".js", "");
          node.specifiers.forEach((specifier) => {
            if (specifier.type === "ImportNamespaceSpecifier") {
              const alias = specifier.local.name;
              if (alias !== filename) {
                context.report({
                  node: specifier,
                  message: `Namespace import '${alias}' does not match filename '${filename}'`,
                });
              }
            }
          });
        }
      },
    };
  },
};
