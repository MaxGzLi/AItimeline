// Metro config for the monorepo. Two things beyond the Expo default:
//   1. watchFolders + nodeModulesPaths so Metro can resolve hoisted deps and
//      files that live outside apps/mobile (the workspace root node_modules).
//   2. A resolver alias that maps the bare "@aitimeline/core" import to the
//      package's COMPILED output (packages/core/dist). Core's TypeScript source
//      uses ESM ".js" import specifiers that Metro won't remap to ".ts", so we
//      bundle the built JS instead. Run `npm run build -w @aitimeline/core`
//      before `expo start` (the root `npm run build` already does this).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const coreDistEntry = path.resolve(workspaceRoot, "packages/core/dist/index.js");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@aitimeline/core") {
    return { type: "sourceFile", filePath: coreDistEntry };
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
