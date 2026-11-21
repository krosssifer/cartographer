const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: [path.resolve('scripts/_preview_terrain.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: '.tmp/_preview_terrain.cjs',
    logLevel: 'error',
    plugins: [
      {
        name: 'vite-shims',
        setup(build) {
          build.onResolve({ filter: /\.webp(\?.*)?$/ }, (args) => ({ path: args.path, namespace: 'webp-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'webp-stub' }, () => ({ contents: 'export default "";', loader: 'ts' }));
          build.onLoad({ filter: /src[\\/]lib[\\/]assets\.ts$/ }, (args) => {
            let text = fs.readFileSync(args.path, 'utf8');
            text = text.replace(/import\.meta\.glob\([^)]*\)/g, '({} as Record<string, string>)');
            return { contents: text, loader: 'ts', resolveDir: path.dirname(args.path) };
          });
        },
      },
    ],
  })
  .then(() => console.log('preview harness built'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
