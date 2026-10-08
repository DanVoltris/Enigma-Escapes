// Lets a test import a lib module that imports its neighbours the way the app
// writes them — `from "./format"`, with no extension. Node insists on the
// extension; Next and TypeScript do not, so without this only modules that
// import nothing but types can be tested at all.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // Not a TypeScript neighbour after all — let Node say so itself.
      }
    }
    return next(specifier, context);
  },
});
