/*
 * typescript-eslint (8.72) supports TypeScript up to 6.0. The project uses TypeScript 7 for `tsc`,
 * but TypeScript 7 has no JS compiler API, so typescript-eslint cannot use it.
 * This hook gives every typescript-eslint package its own TypeScript 6.0 instead of the project's one.
 * Remove this file when typescript-eslint supports TypeScript 7.
 */
const TYPESCRIPT_FOR_LINT = '6.0.3';

const usesTypescriptApi = (name) => name === 'typescript-eslint' || name.startsWith('@typescript-eslint/');

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (!usesTypescriptApi(pkg.name) || !pkg.peerDependencies?.typescript) return pkg;
      delete pkg.peerDependencies.typescript;
      pkg.dependencies = { ...pkg.dependencies, typescript: TYPESCRIPT_FOR_LINT };
      return pkg;
    },
  },
};
