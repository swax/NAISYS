/* This rule ensures when you do an import like this:
`import * as costTracker from "./costTracker.js";`
That the alias matches the filename in this case `costTracker`.

NAISYS uses aliases by convention so that when services are imported, all calls to the service
are prefixed with the service name, and that name matches the file which is enforced by this rule.*/
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
