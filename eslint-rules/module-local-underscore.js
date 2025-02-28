export default {
  create: function (context) {
    // This object will store the local variables and functions
    let localDeclarations = new Set();

    return {
      // Check every variable and function declaration
      VariableDeclaration: function (node) {
        node.declarations.forEach((decl) => {
          if (decl.id && decl.id.name && !decl.id.name.startsWith("_")) {
            localDeclarations.add([decl, decl.id.name]);
          }
        });
      },
      FunctionDeclaration: function (node) {
        if (node.id && node.id.name && !node.id.name.startsWith("_")) {
          localDeclarations.add([node, node.id.name]);
        }
      },

      // After all code is parsed, report all the non-prefixed locals
      "Program:exit": function () {
        localDeclarations.forEach(([node, name]) => {
          context.report({
            node,
            message: `Local declaration '${name}' should be prefixed with an underscore.`,
          });
        });
      },
    };
  },
};
