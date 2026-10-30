const AI_CACHE_NAME = 'timemark-editor-local-ai-v1';

/**
 * Convert the editor's one-byte glyph mask to the RGBA mask expected by
 * browser-watermark-removal. A small circular halo removes anti-aliased edges
 * without turning the whole text line into a rectangle.
 */
export function createLocalAiMask(maskBits, width, height, dilationRadius = 2) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('AI mask dimensions must be positive integers.');
  }
  if (!maskBits || maskBits.length !== width * height) {
    throw new RangeError('AI mask data must match its dimensions.');
  }

  const radius = Number.isFinite(dilationRadius)
    ? Math.max(0, Math.min(8, Math.round(dilationRadius)))
    : 0;
  const expanded = new Uint8Array(width * height);
  const radiusSquared = radius * radius;

  for (let index = 0; index < maskBits.length; index += 1) {
    if (maskBits[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      const targetY = y + dy;
      if (targetY < 0 || targetY >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radiusSquared) continue;
        const targetX = x + dx;
        if (targetX >= 0 && targetX < width) expanded[targetY * width + targetX] = 255;
      }
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < expanded.length; index += 1) {
    if (expanded[index] === 0) continue;
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = 255;
  }

  return typeof globalThis.ImageData === 'function'
    ? new globalThis.ImageData(rgba, width, height)
    : { data: rgba, width, height };
}

/**
 * Run MI-GAN through ONNX Runtime Web. The input image and mask stay in memory
 * on this device; network access is used only to download the public model
 * on first use. The ONNX runtime and its WebAssembly files are app assets.
 */
export async function runLocalAiCleanup(image, mask, callbacks = {}) {
  const { configureCore, removeWatermark } = await import('browser-watermark-removal');
  const onnxWasmPath = `${import.meta.env.BASE_URL}ai/ort/`;

  configureCore({
    cacheName: AI_CACHE_NAME,
    executionProviders: ['webgpu', 'wasm'],
    logLevel: 'error',
    // The matching ONNX Runtime WASM and worker files are copied into this
    // app's public/ai/ort directory at build time.
    ortWasmPaths: onnxWasmPath,
  });

  return removeWatermark(image, {
    mask,
    engine: 'migan',
    quality: 'balanced',
    passes: 2,
    fastFill: false,
    onProgress: callbacks.onProgress,
    onStage: callbacks.onStage,
    onPass: callbacks.onPass,
  });
}
