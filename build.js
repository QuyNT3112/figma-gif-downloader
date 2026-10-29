// Figma Plugin Bundler (esbuild)
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function buildAll() {
  const distDir = path.resolve(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 1. Bundle Figma sandbox code (code.ts -> dist/code.js)
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/code.ts')],
    bundle: true,
    outfile: path.resolve(distDir, 'code.js'),
    target: 'es2020',
    platform: 'neutral',
    format: 'iife',
    minify: false,
    sourcemap: false,
  });

  // 2. Bundle UI logic (src/ui.ts + jszip + gifenc) in memory
  const uiBuildResult = await esbuild.build({
    entryPoints: [path.resolve(__dirname, 'src/ui.ts')],
    bundle: true,
    write: false,
    target: 'es2020',
    platform: 'browser',
    format: 'iife',
    minify: false,
  });

  const bundledUiJs = uiBuildResult.outputFiles[0].text;

  // 3. Read src/ui.html and inject bundled JS
  const htmlTemplatePath = path.resolve(__dirname, 'src/ui.html');
  let htmlContent = fs.readFileSync(htmlTemplatePath, 'utf8');

  // Replace placeholder or inject before </body>
  if (htmlContent.includes('<!-- INJECT_UI_SCRIPT -->')) {
    htmlContent = htmlContent.replace('<!-- INJECT_UI_SCRIPT -->', `<script>\n${bundledUiJs}\n</script>`);
  } else {
    htmlContent = htmlContent.replace('</body>', `<script>\n${bundledUiJs}\n</script>\n</body>`);
  }

  fs.writeFileSync(path.resolve(distDir, 'ui.html'), htmlContent, 'utf8');

  console.log(`[${new Date().toLocaleTimeString()}]  Build succeeded -> dist/code.js & dist/ui.html`);
}

async function main() {
  try {
    await buildAll();

    if (isWatch) {
      console.log('Watching for changes in src/...');
      const srcDir = path.resolve(__dirname, 'src');
      let timeout = null;
      fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
          console.log(`File changed: ${filename}. Rebuilding...`);
          try {
            await buildAll();
          } catch (err) {
            console.error('Rebuild failed:', err);
          }
        }, 100);
      });
    }
  } catch (err) {
    console.error('Build error:', err);
    process.exit(1);
  }
}

main();
