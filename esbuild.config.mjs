import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const watch = process.argv.includes('--watch');

const commonOpts = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

const builds = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js', external: ['electron'] },
  { entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js', external: ['electron'] },
  {
    entryPoints: ['src/renderer/index.ts'],
    outfile: 'dist/renderer/index.js',
    platform: 'browser',
    target: 'es2020',
  },
];

async function run() {
  for (const build of builds) {
    const opts = { ...commonOpts, ...build };
    if (watch) {
      const ctx = await esbuild.context(opts);
      await ctx.watch();
    } else {
      await esbuild.build(opts);
    }
  }
  const staticFiles = ['index.html', 'style.css'];
  for (const file of staticFiles) {
    fs.mkdirSync('dist/renderer', { recursive: true });
    fs.copyFileSync(path.join('src/renderer', file), path.join('dist/renderer', file));
  }
  fs.mkdirSync('dist/renderer/assets', { recursive: true });
  fs.cpSync('src/renderer/assets', 'dist/renderer/assets', { recursive: true });

  if (watch) {
    console.log('esbuild watching for changes...');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
