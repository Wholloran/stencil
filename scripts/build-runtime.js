const fs = require('fs-extra');
const path = require('path');
const rollup = require('rollup');
const { run, transpile } = require('./script-utils');
const { minifyClientCore } = require('./minify-client-core');
const buildPolyfills = require('./build-polyfills');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DST_DIR = path.join(ROOT_DIR, 'dist');
const TRANSPILED_DIR = path.join(DST_DIR, 'transpiled-runtime');
const DIST_RUNTIME_DIR = path.join(DST_DIR, 'runtime');
const DIST_CLIENT_DIR = path.join(DST_DIR, 'client');

const runtimeInputFile = path.join(TRANSPILED_DIR, 'runtime', 'index.js');
const clientInputFile = path.join(TRANSPILED_DIR, 'client', 'index.js');
const utilsInputFile = path.join(TRANSPILED_DIR, 'utils', 'index.js');

const outputPolyfillsDir = path.join(DIST_CLIENT_DIR, 'polyfills');
const transpiledPolyfillsDir = path.join(TRANSPILED_DIR, 'client', 'polyfills');


async function bundleRuntime() {
  const rollupBuild = await rollup.rollup({
    input: runtimeInputFile,
    external: [
      '@stencil/core/build-conditionals',
      '@stencil/core/platform',
      '@stencil/core/utils'
    ],
    plugins: [
      (() => {
        return {
          resolveId(id) {
            if (id === '@build-conditionals') {
              return '@stencil/core/build-conditionals';
            }
            if (id === '@platform') {
              return '@stencil/core/platform';
            }
            if (id === '@utils') {
              return '@stencil/core/utils';
            }
          }
        }
      })()
    ],
    onwarn: (message) => {
      if (message.code === 'CIRCULAR_DEPENDENCY') return;
      console.error(message);
    }
  });

  await Promise.all([
    rollupBuild.write({
      format: 'esm',
      file: path.join(DIST_RUNTIME_DIR, 'index.mjs')
    }),
    rollupBuild.write({
      format: 'cjs',
      file: path.join(DIST_RUNTIME_DIR, 'index.js')
    })
  ]);
}


async function bundleClient() {
  const rollupBuild = await rollup.rollup({
    input: clientInputFile,
    external: [
      '@stencil/core/build-conditionals'
    ],
    plugins: [
      (() => {
        return {
          resolveId(id) {
            if (id === '@build-conditionals') {
              return '@stencil/core/build-conditionals';
            }
            if (id === '@platform') {
              return clientInputFile;
            }
            if (id === '@runtime') {
              return runtimeInputFile;
            }
            if (id === '@utils') {
              return utilsInputFile;
            }
          }
        }
      })()
    ],
    onwarn: (message) => {
      if (message.code === 'CIRCULAR_DEPENDENCY') return;
      console.error(message);
    }
  });

  const results = await Promise.all([
    rollupBuild.write({
      format: 'esm',
      file: path.join(DIST_CLIENT_DIR, 'index.mjs')
    }),
    rollupBuild.write({
      format: 'cjs',
      file: path.join(DIST_CLIENT_DIR, 'index.js')
    })
  ]);

  const minifyOutput = minifyClientCore(results[0].output[0].code);

  const minifiedClientMjsPath = path.join(DIST_CLIENT_DIR, 'index.min.mjs');

  await fs.writeFile(minifiedClientMjsPath, minifyOutput.code);
}


async function createPublicJavaScriptExports() {
  const entryPath = path.join(DST_DIR, 'index.js');

  await fs.writeFile(entryPath,
    `export function h() {}`
  );
}


async function createPublicTypeExports() {
  const declarationsContent = [];
  const declarationsDir = path.join(TRANSPILED_DIR, 'declarations');

  const declarationFileNames = (await fs.readdir(declarationsDir)).filter(f => f !== 'index.d.ts');

  declarationFileNames.forEach(declarationsFile => {
    const declarationsPath = path.join(declarationsDir, declarationsFile);
    if (declarationsPath.endsWith('.d.ts')) {

      let fileContent = fs.readFileSync(declarationsPath, 'utf8');
      fileContent = fileContent.replace(/import \* as d (.*);/g, '');
      fileContent = fileContent.replace(/\: d\./g, ': ');
      fileContent = fileContent.replace(/<d\./g, '<');
      fileContent = fileContent.replace(/\, d\./g, ', ');
      fileContent = fileContent.replace(/=> d\./g, '=> ');
      fileContent = fileContent.replace(/\| d\./g, '| ');
      fileContent = fileContent.replace(/extends d\./g, 'extends ');
      fileContent = fileContent.trim();

      declarationsContent.push(fileContent);
    }
  });

  let fileContent = declarationsContent.join('\n');

  const outputDeclarationsFile = path.join(DST_DIR, 'declarations', 'index.d.ts');
  await fs.emptyDir(path.dirname(outputDeclarationsFile));
  await fs.writeFile(outputDeclarationsFile, fileContent);

  const transpiledDeclarationsIndexPath = path.join(TRANSPILED_DIR, 'index.d.ts');
  const distDeclarationsIndexPath = path.join(DST_DIR, 'index.d.ts');
  await fs.copyFile(transpiledDeclarationsIndexPath, distDeclarationsIndexPath);
}


async function createDts() {
  const declarationSrcFiles = [
    path.join(SRC_DIR, 'declarations', 'component-interfaces.ts'),
    path.join(SRC_DIR, 'declarations', 'jsx.ts'),
    path.join(SRC_DIR, 'declarations', 'vdom.ts')
  ];

  const declarationsFileContents = declarationSrcFiles
    .map(sf => fs.readFileSync(sf, { encoding: 'utf8'} ).toString())
    .join('\n');

  const declarationsFilePath = path.join(DIST_RUNTIME_DIR, 'declarations', 'stencil.core.d.ts');

  await fs.emptyDir(path.dirname(declarationsFilePath));
  await fs.writeFile(declarationsFilePath, declarationsFileContents);
}


run(async ()=> {
  transpile(path.join('..', 'src', 'runtime', 'tsconfig.json'));

  await fs.emptyDir(DIST_RUNTIME_DIR);

  await bundleRuntime();

  await Promise.all([
    bundleClient(),
    buildPolyfills(transpiledPolyfillsDir, outputPolyfillsDir),
    createDts(),
    createPublicTypeExports(),
    createPublicJavaScriptExports()
  ]);

  await fs.remove(TRANSPILED_DIR);
});