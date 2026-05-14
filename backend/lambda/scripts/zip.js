const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const esbuild = require('esbuild');

const LAMBDA_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(LAMBDA_DIR, '..', 'dist-lambda');

// each entry here becomes one zip I can upload straight to the matching lambda
const artifacts = [
  { name: 'music-login', entry: 'login.js' },
  { name: 'music-register', entry: 'register.js' },
  { name: 'music-query-songs', entry: 'querySongs.js' },
  { name: 'music-get-subs', entry: 'getSubscriptions.js' },
  { name: 'music-subscribe', entry: 'subscribe.js' },
  { name: 'music-unsubscribe', entry: 'unsubscribe.js' }
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// bundle + zip one handler — keeps each artifact small without vendoring all of node_modules
function zipOne({ name, entry }) {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(OUT_DIR, `${name}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve({ zipPath, bytes: archive.pointer() }));
    output.on('error', reject);

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') return;
      reject(err);
    });
    archive.on('error', reject);

    archive.pipe(output);

    // bundle deps into a single file so the zip isn't a bloated node_modules dump
    const bundledOut = path.join(OUT_DIR, entry);
    try {
      esbuild.buildSync({
        entryPoints: [path.join(LAMBDA_DIR, entry)],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: ['node18'],
        outfile: bundledOut,
        sourcemap: false,
        minify: false
      });
    } catch (err) {
      reject(err);
      return;
    }

    archive.file(bundledOut, { name: entry });

    archive.finalize();
  });
}

async function main() {
  ensureDir(OUT_DIR);

  const results = [];
  for (const a of artifacts) {
    // serial is fine here — six tiny bundles and easier to read if something blows up
    // eslint-disable-next-line no-await-in-loop
    const r = await zipOne(a);
    results.push(r);
  }

  for (const r of results) {
    console.log(`Wrote ${r.zipPath} (${r.bytes} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

