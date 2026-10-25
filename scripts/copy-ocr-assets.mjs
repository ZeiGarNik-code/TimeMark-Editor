import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicRoot = join(root, 'public', 'ocr');
const coreRoot = join(root, 'node_modules', 'tesseract.js-core');
const tesseractRoot = join(root, 'node_modules', 'tesseract.js');
const languageRoot = join(root, 'node_modules', '@tesseract.js-data');
const visionRoot = join(root, 'node_modules', '@techstark', 'opencv-js');

const assets = [
  [join(tesseractRoot, 'dist', 'worker.min.js'), join(publicRoot, 'worker.min.js')],
  ['tesseract-core.wasm.js', 'tesseract-core.wasm.js'],
  ['tesseract-core-simd.wasm.js', 'tesseract-core-simd.wasm.js'],
  ['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract-core-relaxedsimd.wasm.js', 'tesseract-core-relaxedsimd.wasm.js'],
  ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
].map(([source, destination]) => [
  isAbsolute(source) ? source : join(coreRoot, source),
  isAbsolute(destination) ? destination : join(publicRoot, 'core', destination),
]);

for (const [language, filename] of [['vie', 'vie.traineddata.gz'], ['eng', 'eng.traineddata.gz']]) {
  assets.push([
    join(languageRoot, language, '4.0.0_best_int', filename),
    join(publicRoot, 'lang', filename),
  ]);
}

assets.push([join(visionRoot, 'dist', 'opencv.js'), join(publicRoot, 'opencv.js')]);

for (const [source, destination] of assets) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

await copyFile(join(tesseractRoot, 'LICENSE.md'), join(publicRoot, 'LICENSE.tesseract.js.md'));
await copyFile(join(coreRoot, 'LICENSE'), join(publicRoot, 'LICENSE.tesseract-core'));
await copyFile(join(visionRoot, 'LICENSE'), join(publicRoot, 'LICENSE.opencv-js'));
await writeFile(join(publicRoot, 'NOTICE.txt'), [
  'OCR runtime: Tesseract.js 7, licensed under Apache-2.0.',
  'Tesseract.js-core assets are licensed under Apache-2.0.',
  'Vietnamese and English traineddata are packaged from @tesseract.js-data/vie and @tesseract.js-data/eng (MIT package license).',
  'OpenCV.js is licensed under Apache-2.0 and is used for local image inpainting.',
  'OCR and image inpainting run on this device. Image pixels are not sent to a remote service.',
  '',
].join('\n'));

console.log(`Prepared ${assets.length} local OCR and vision assets in public/ocr.`);
