import { formatTimeToMinutes } from './timeFormat.js';

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export const DEFAULT_REGION = { x: 0.56, y: 0.70, w: 0.40, h: 0.25, corner: 'bottom-right' };

/** Expand a narrow bottom-corner scan to include the complete multi-line stamp. */
export function expandDetectedStampRegion(region, corner = region?.corner ?? 'bottom-right') {
  if (!region || !corner.startsWith('bottom') || region.w >= 0.68) return region;
  const width = 0.76;
  const margin = 0.012;
  const x = corner.endsWith('left') ? 0 : 1 - width - margin;
  const bottom = Math.min(1, region.y + region.h);
  const verticalPadding = Math.max(0.045, Math.min(0.09, region.h * 0.71));
  const y = Math.max(0, region.y - verticalPadding);
  return {
    ...region,
    x,
    y,
    w: Math.min(width, 1 - x),
    h: Math.max(0.03, bottom - y),
    corner,
  };
}

/**
 * Estimate the timestamp block in the four corners of a photo. This is a
 * contrast/edge scan (not OCR): it suggests a starting box that the user can
 * check and reposition before exporting.
 */
export function scanCornerText(imageData) {
  const { data, width, height } = imageData;
  if (!data || width < 8 || height < 8) return { ...DEFAULT_REGION, confidence: 0 };

  const candidates = [];
  for (const corner of CORNERS) {
    const zoneW = Math.max(8, Math.round(width * 0.46));
    const zoneH = Math.max(8, Math.round(height * 0.38));
    const startX = corner.endsWith('right') ? width - zoneW : 0;
    const startY = corner.startsWith('bottom') ? height - zoneH : 0;
    const rowScores = new Float32Array(zoneH);

    for (let zy = 1; zy < zoneH - 1; zy += 1) {
      const y = startY + zy;
      for (let zx = 1; zx < zoneW - 1; zx += 1) {
        const x = startX + zx;
        const i = (y * width + x) * 4;
        const here = luma(data, i);
        const right = luma(data, i + 4);
        const below = luma(data, i + width * 4);
        const edge = Math.abs(here - right) + Math.abs(here - below);
        if (edge > 54) rowScores[zy] += 1;
      }
    }

    const smoothRows = new Float32Array(zoneH);
    for (let y = 1; y < zoneH - 1; y += 1) {
      smoothRows[y] = (rowScores[y - 1] + rowScores[y] + rowScores[y + 1]) / 3;
    }
    const rowThreshold = Math.max(2.5, zoneW * 0.018);
    const activeRows = [];
    for (let y = 1; y < zoneH - 1; y += 1) {
      if (smoothRows[y] > rowThreshold) activeRows.push(y);
    }

    const lineGroups = groupNearby(activeRows, 2);
    const groups = mergeLineGroups(lineGroups, zoneH * 0.82);
    let best = null;
    for (const group of groups) {
      const groupHeight = group.end - group.start + 1;
      if (groupHeight < Math.max(4, zoneH * 0.045) || groupHeight > zoneH * 0.82) continue;

      let minX = zoneW;
      let maxX = 0;
      let edgeMass = 0;
      const groupColumns = new Float32Array(zoneW);
      const rowStart = Math.max(1, group.start - 2);
      const rowEnd = Math.min(zoneH - 2, group.end + 2);
      for (let y = rowStart; y <= rowEnd; y += 1) {
        const imageY = startY + y;
        for (let x = 1; x < zoneW - 1; x += 1) {
          const imageX = startX + x;
          const i = (imageY * width + imageX) * 4;
          const here = luma(data, i);
          const edge = Math.abs(here - luma(data, i + 4)) + Math.abs(here - luma(data, i + width * 4));
          if (edge > 54) groupColumns[x] += 1;
        }
      }
      const columnThreshold = Math.max(1, (rowEnd - rowStart + 1) * 0.055);
      for (let x = 1; x < zoneW - 1; x += 1) {
        if (groupColumns[x] > columnThreshold) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          edgeMass += groupColumns[x];
        }
      }
      if (maxX <= minX) continue;
      const boxW = maxX - minX + 1;
      if (boxW < zoneW * 0.10 || boxW > zoneW * 0.96) continue;

      const rowMass = group.rows.reduce((total, row) => total + smoothRows[row], 0);
      const density = rowMass / (boxW * groupHeight + 1);
      const compactness = Math.max(0, 1 - groupHeight / (zoneH * 0.90));
      const score = Math.sqrt(rowMass) * compactness * Math.min(1, boxW / (zoneW * 0.62)) * (0.65 + density * 0.35);
      if (!best || score > best.score) best = { score, minX, maxX, startY: group.start, endY: group.end, edgeMass };
    }

    if (best) {
      const padX = Math.max(5, Math.round(zoneW * 0.018));
      const padY = Math.max(4, Math.round(zoneH * 0.055));
      const localX = Math.max(0, best.minX - padX);
      const localY = Math.max(0, best.startY - padY);
      const localRight = Math.min(zoneW, best.maxX + padX);
      const localBottom = Math.min(zoneH, best.endY + padY);
      const x = startX + localX;
      const y = startY + localY;
      const w = localRight - localX;
      const h = localBottom - localY;
      candidates.push({
        corner,
        x: x / width,
        y: y / height,
        w: w / width,
        h: h / height,
        score: best.score,
      });
    } else {
      candidates.push({ corner, ...fallbackForCorner(corner), score: 0 });
    }
  }

  const highest = Math.max(...candidates.map((item) => item.score));
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];
  const confidence = highest <= 0 ? 0 : Math.min(0.94, Math.max(0.35, 0.52 + ((top.score - second.score) / (top.score + 1)) * 0.6));
  return { ...top, confidence };
}

/** Remove pixels close to the sampled ink color and softly reconstruct only those strokes. */
export function inpaintInk(imageData, inkColor = { r: 255, g: 255, b: 255 }, tolerance = 74) {
  const { data, width, height } = imageData;
  const count = width * height;
  if (!data || count < 1) return imageData;

  const candidates = new Uint8Array(count);
  const labels = new Uint8Array(count);
  const maxDistance = tolerance * tolerance * 3;
  for (let i = 0; i < count; i += 1) {
    const p = i * 4;
    const dr = data[p] - inkColor.r;
    const dg = data[p + 1] - inkColor.g;
    const db = data[p + 2] - inkColor.b;
    if (dr * dr + dg * dg + db * db <= maxDistance) candidates[i] = 1;
  }

  const queue = new Int32Array(count);
  const components = [];
  for (let seed = 0; seed < count; seed += 1) {
    if (!candidates[seed] || labels[seed]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    labels[seed] = 1;
    queue[tail++] = seed;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (candidates[next] && !labels[next]) {
            labels[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const areaLimit = count * 0.075;
    const plausibleGlyph = tail >= 2 && tail <= areaLimit && boxWidth <= Math.max(8, width * 0.22) && boxHeight <= Math.max(8, height * 0.72);
    if (plausibleGlyph) components.push({ start: seed, size: tail });
  }

  if (!components.length) return imageData;

  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    if (labels[i]) {
      // Component bounds are filtered below; only retained component labels are marked as 2.
      labels[i] = 0;
    }
  }
  // Rebuild the kept mask. Component flood fills are repeated only for the small retained set.
  for (const component of components) {
    let head = 0;
    let tail = 0;
    queue[tail++] = component.start;
    labels[component.start] = 1;
    while (head < tail) {
      const index = queue[head++];
      mask[index] = 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (candidates[next] && !labels[next]) {
            labels[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
  }

  // Expand by a tiny radius so anti-aliased edges and a soft drop shadow are removed too.
  const expanded = new Uint8Array(count);
  const radius = 2;
  for (let index = 0; index < count; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        if (nx >= 0 && nx < width) expanded[ny * width + nx] = 1;
      }
    }
  }

  let expandedCount = 0;
  for (let index = 0; index < count; index += 1) if (expanded[index]) expandedCount += 1;
  const maskedIndices = new Int32Array(expandedCount);
  let cursor = 0;
  for (let index = 0; index < count; index += 1) if (expanded[index]) maskedIndices[cursor++] = index;

  let current = new Uint8ClampedArray(data);
  let next = new Uint8ClampedArray(data);
  // Harmonic fill: repeated four-neighbour diffusion is confined to the ink mask.
  for (let iteration = 0; iteration < 18; iteration += 1) {
    next.set(current);
    for (const index of maskedIndices) {
      const y = Math.floor(index / width);
      const x = index - y * width;
      let samples = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let neighborOffset;
      if (x > 0) {
        neighborOffset = (index - 1) * 4;
        r += current[neighborOffset]; g += current[neighborOffset + 1]; b += current[neighborOffset + 2]; samples += 1;
      }
      if (x < width - 1) {
        neighborOffset = (index + 1) * 4;
        r += current[neighborOffset]; g += current[neighborOffset + 1]; b += current[neighborOffset + 2]; samples += 1;
      }
      if (y > 0) {
        neighborOffset = (index - width) * 4;
        r += current[neighborOffset]; g += current[neighborOffset + 1]; b += current[neighborOffset + 2]; samples += 1;
      }
      if (y < height - 1) {
        neighborOffset = (index + width) * 4;
        r += current[neighborOffset]; g += current[neighborOffset + 1]; b += current[neighborOffset + 2]; samples += 1;
      }
      if (samples) {
        const offset = index * 4;
        next[offset] = r / samples;
        next[offset + 1] = g / samples;
        next[offset + 2] = b / samples;
      }
    }
    [current, next] = [next, current];
  }

  // Keep untouched pixels byte-for-byte identical; only the detected ink neighbourhood is replaced.
  for (let index = 0; index < count; index += 1) {
    if (!expanded[index]) continue;
    const offset = index * 4;
    current[offset + 3] = data[offset + 3];
  }
  return typeof ImageData !== 'undefined'
    ? new ImageData(current, width, height)
    : { data: current, width, height };
}

export function createInkMask(imageData, inkColor = { r: 255, g: 255, b: 255 }, tolerance = 74) {
  const { data, width, height } = imageData;
  const count = width * height;
  const mask = new Uint8Array(count);
  if (!data || width < 1 || height < 1) return mask;

  const candidates = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  const maxDistance = tolerance * tolerance * 3;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const dr = data[offset] - inkColor.r;
    const dg = data[offset + 1] - inkColor.g;
    const db = data[offset + 2] - inkColor.b;
    if (dr * dr + dg * dg + db * db <= maxDistance) candidates[index] = 1;
  }

  const areaLimit = count * 0.075;
  for (let seed = 0; seed < count; seed += 1) {
    if (!candidates[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    visited[seed] = 1;
    queue[tail++] = seed;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (candidates[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const plausibleGlyph = tail >= 2 && tail <= areaLimit
      && boxWidth <= Math.max(8, width * 0.22)
      && boxHeight <= Math.max(8, height * 0.72);
    if (plausibleGlyph) {
      for (let index = 0; index < tail; index += 1) mask[queue[index]] = 255;
    }
  }

  addThinAccentMasks(data, width, height, mask);
  return mask;
}

/** Remove sampled ink with local OpenCV Telea inpainting to keep textured backgrounds crisp. */
export function inpaintInkWithOpenCV(imageData, inkColor, tolerance, cv) {
  const { data, width, height } = imageData;
  if (!data || width < 1 || height < 1 || !cv?.inpaint || !cv?.matFromImageData) return imageData;
  const maskData = createInkMask(imageData, inkColor, tolerance);
  if (!maskData.some(Boolean)) return imageData;

  const mats = [];
  const track = (mat) => { mats.push(mat); return mat; };
  try {
    const sourceRgba = track(cv.matFromImageData(imageData));
    const sourceRgb = track(new cv.Mat());
    cv.cvtColor(sourceRgba, sourceRgb, cv.COLOR_RGBA2RGB);

    const mask = track(new cv.Mat(height, width, cv.CV_8UC1));
    mask.data.set(maskData);
    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)));
    const expandedMask = track(new cv.Mat());
    cv.dilate(mask, expandedMask, kernel, new cv.Point(-1, -1), 1);

    const restoredRgb = track(new cv.Mat());
    cv.inpaint(sourceRgb, expandedMask, restoredRgb, 3, cv.INPAINT_TELEA);
    const output = new Uint8ClampedArray(data);
    for (let index = 0; index < width * height; index += 1) {
      const sourceOffset = index * 3;
      const outputOffset = index * 4;
      output[outputOffset] = restoredRgb.data[sourceOffset];
      output[outputOffset + 1] = restoredRgb.data[sourceOffset + 1];
      output[outputOffset + 2] = restoredRgb.data[sourceOffset + 2];
    }
    return typeof ImageData !== 'undefined' ? new ImageData(output, width, height) : { data: output, width, height };
  } finally {
    for (const mat of mats.reverse()) mat.delete();
  }
}

export function detectAccentDivider(imageData) {
  const { data, width, height } = imageData ?? {};
  const divider = findAccentDivider(data, width, height);
  if (!divider) return null;
  const { pixels, ...geometry } = divider;
  return geometry;
}

/**
 * Infer the TimeMark stamp's typography from its orange divider and the ink
 * geometry around it. The two detail rows are scanned in separate divider-
 * relative bands so bright background texture cannot merge date and weekday.
 */
export function inferStampTypography(imageData, inkColor = { r: 255, g: 255, b: 255 }) {
  const { width, height } = imageData ?? {};
  if (!imageData?.data || width < 16 || height < 16) return null;
  const divider = detectAccentDivider(imageData);
  if (!divider) return null;

  const tolerance = 34;
  const rightStart = divider.x + divider.w + Math.max(2, Math.round(width * 0.003));
  const rightWidth = Math.max(1, width - rightStart);
  const upperHeight = Math.max(4, Math.round(divider.h * 0.47));
  const lowerStart = divider.y + Math.round(divider.h * 0.55);
  const lowerHeight = Math.max(1, divider.y + divider.h - lowerStart);
  const timeLine = chooseInkLine(findInkLines(imageData, {
    x: 0, y: divider.y, w: divider.x, h: divider.h,
  }, inkColor, tolerance), divider.h * 0.35, divider.h * 1.3, divider.h * 0.3);
  const dateLine = chooseInkLine(findInkLines(imageData, {
    x: rightStart, y: divider.y, w: rightWidth, h: upperHeight,
  }, inkColor, tolerance), divider.h * 0.12, divider.h * 0.7, divider.h * 0.25);
  const weekdayLine = chooseInkLine(findInkLines(imageData, {
    x: rightStart, y: lowerStart, w: rightWidth, h: lowerHeight,
  }, inkColor, tolerance), divider.h * 0.12, divider.h * 0.7, divider.h * 0.2);
  const addressStart = divider.y + divider.h + Math.round(divider.h * 0.12);
  const addressLines = findInkLines(imageData, {
    x: 0, y: addressStart, w: width, h: Math.max(1, height - addressStart),
  }, inkColor, tolerance)
    .filter((line) => line.height >= divider.h * 0.12 && line.height <= divider.h * 0.72 && line.width >= divider.h * 0.35)
    .sort((a, b) => a.y - b.y)
    .slice(0, 3);

  const detailLines = [dateLine, weekdayLine].filter(Boolean);
  if (!timeLine || !detailLines.length) return null;

  const detailGlyphHeight = (dateLine ?? weekdayLine).height;
  const addressGlyphHeight = addressLines[0]?.height ?? detailGlyphHeight;
  const detailPitch = dateLine && weekdayLine ? weekdayLine.y - dateLine.y : null;
  const addressPitches = addressLines.slice(1).map((line, index) => line.y - addressLines[index].y)
    .filter((pitch) => pitch > addressGlyphHeight * 0.75 && pitch < divider.h * 1.5);
  const inkCoverage = median([...detailLines, ...addressLines].map((line) => line.coverage));
  const timeAspectRatio = timeLine.width / Math.max(1, timeLine.height);
  const leftEdges = [timeLine.x, ...addressLines.slice(0, 1).map((line) => line.x)];
  const textPaddingRatio = median(leftEdges) / width;
  const detailGapRatio = (dateLine ?? weekdayLine).x - (divider.x + divider.w);

  return {
    divider,
    fontFamily: timeAspectRatio <= 2.45
      ? '"Roboto Condensed", "Arial Narrow", Arial, sans-serif'
      : 'Arial, Helvetica, sans-serif',
    // The photo sample's time line is slightly heavier than its fine-print
    // rows. Keep the default at regular instead of making the whole stamp bold.
    weight: inkCoverage < 0.12 ? 300 : inkCoverage < 0.29 ? 400 : 700,
    timeWeight: inkCoverage < 0.29 ? 500 : 700,
    timeGlyphScale: clamp(timeLine.height / divider.h, 0.55, 1.25),
    detailGlyphScale: clamp(detailGlyphHeight / divider.h, 0.18, 0.68),
    addressGlyphScale: clamp(addressGlyphHeight / divider.h, 0.18, 0.68),
    detailPitchScale: detailPitch ? clamp(detailPitch / divider.h, 0.15, 1.5) : null,
    addressPitchScale: addressPitches.length
      ? clamp(median(addressPitches) / divider.h, 0.15, 1.5)
      : null,
    detailLineHeight: detailPitch ? clamp(detailPitch / detailGlyphHeight, 0.9, 1.8) : 1.18,
    addressLineHeight: addressPitches.length
      ? clamp(median(addressPitches) / addressGlyphHeight, 0.9, 1.8)
      : 1.08,
    detailGapRatio: clamp(detailGapRatio / width, 0.006, 0.08),
    addressGapRatio: addressLines.length
      ? clamp((addressLines[0].y - (divider.y + divider.h)) / divider.h, 0.08, 0.75)
      : 0.30,
    textPaddingRatio: clamp(textPaddingRatio, 0.01, 0.10),
    align: 'left',
    opacity: 1,
    shadow: true,
    sourceWidths: {
      time: timeLine.width,
      date: dateLine?.width ?? null,
      weekday: weekdayLine?.width ?? null,
      address: addressLines.map((line) => line.width),
    },
    sourcePositions: {
      timeX: timeLine.x,
    },
    metrics: {
      time: timeLine,
      date: dateLine,
      weekday: weekdayLine,
      address: addressLines,
      inkCoverage,
      timeAspectRatio,
    },
  };
}

function findInkLines(imageData, box, inkColor, tolerance) {
  const { data, width, height } = imageData;
  const x = Math.max(0, Math.min(width - 1, Math.floor(box.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(box.y)));
  const boxWidth = Math.max(0, Math.min(width - x, Math.ceil(box.w)));
  const boxHeight = Math.max(0, Math.min(height - y, Math.ceil(box.h)));
  if (!data || boxWidth < 1 || boxHeight < 1) return [];

  const rowPixels = new Uint32Array(boxHeight);
  const rowMinX = new Int32Array(boxHeight);
  const rowMaxX = new Int32Array(boxHeight);
  rowMinX.fill(boxWidth);
  rowMaxX.fill(-1);
  const maxDistance = tolerance * tolerance * 3;
  for (let row = 0; row < boxHeight; row += 1) {
    const imageY = y + row;
    for (let column = 0; column < boxWidth; column += 1) {
      const offset = (imageY * width + x + column) * 4;
      const dr = data[offset] - inkColor.r;
      const dg = data[offset + 1] - inkColor.g;
      const db = data[offset + 2] - inkColor.b;
      if (dr * dr + dg * dg + db * db > maxDistance) continue;
      rowPixels[row] += 1;
      rowMinX[row] = Math.min(rowMinX[row], column);
      rowMaxX[row] = Math.max(rowMaxX[row], column);
    }
  }

  const rowThreshold = Math.max(1, Math.round(boxWidth * 0.0012));
  const activeRows = [];
  for (let row = 0; row < boxHeight; row += 1) {
    if (rowPixels[row] >= rowThreshold) activeRows.push(row);
  }
  return groupNearby(activeRows, 2).map((group) => {
    let top = boxHeight;
    let bottom = -1;
    let minX = boxWidth;
    let maxX = -1;
    let inkPixels = 0;
    for (let row = group.start; row <= group.end; row += 1) {
      if (!rowPixels[row]) continue;
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
      minX = Math.min(minX, rowMinX[row]);
      maxX = Math.max(maxX, rowMaxX[row]);
      inkPixels += rowPixels[row];
    }
    const lineHeight = bottom - top + 1;
    const lineWidth = maxX - minX + 1;
    return {
      x: x + minX,
      y: y + top,
      width: lineWidth,
      height: lineHeight,
      inkPixels,
      coverage: inkPixels / Math.max(1, lineWidth * lineHeight),
    };
  }).filter((line) => line.height >= 3 && line.width >= 4);
}

function chooseInkLine(lines, minHeight, maxHeight, minWidth) {
  return lines
    .filter((line) => line.height >= minHeight && line.height <= maxHeight && line.width >= minWidth)
    .sort((a, b) => b.inkPixels - a.inkPixels)[0] ?? null;
}

function addThinAccentMasks(data, width, height, mask) {
  const divider = findAccentDivider(data, width, height);
  if (!divider) return;
  for (const index of divider.pixels) mask[index] = 255;
}

function findAccentDivider(data, width, height) {
  if (!data || width < 4 || height < 16) return null;
  const count = width * height;
  const candidates = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    let hue = 0;
    if (delta > 0) {
      if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
      if (hue < 0) hue += 360;
    }
    if (maximum >= 145 && delta >= 75 && delta / maximum >= 0.42 && hue >= 18 && hue <= 70) candidates[index] = 1;
  }

  let best = null;
  let bestScore = 0;
  for (let seed = 0; seed < count; seed += 1) {
    if (!candidates[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;
    visited[seed] = 1;
    queue[tail++] = seed;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      const offset = index * 4;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      redTotal += data[offset];
      greenTotal += data[offset + 1];
      blueTotal += data[offset + 2];
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (candidates[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const isDivider = boxHeight >= Math.max(16, height * 0.18)
      && boxWidth <= Math.max(4, width * 0.035)
      && boxHeight / boxWidth >= 4
      && minX >= width * 0.06 && minX <= width * 0.62
      && minY <= height * 0.72
      && tail <= count * 0.04;
    if (!isDivider) continue;

    const score = boxHeight * (boxHeight / boxWidth) * Math.sqrt(tail);
    if (score > bestScore) {
      bestScore = score;
      best = {
        x: minX,
        y: minY,
        w: boxWidth,
        h: boxHeight,
        color: {
          r: Math.round(redTotal / tail),
          g: Math.round(greenTotal / tail),
          b: Math.round(blueTotal / tail),
        },
        pixels: queue.slice(0, tail),
      };
    }
  }
  return best;
}

export function estimateTextMetrics(imageData, inkColor = { r: 255, g: 255, b: 255 }) {
  const { data, width, height } = imageData;
  if (!data || width < 4 || height < 4) return null;
  const rows = new Uint16Array(height);
  const columns = new Uint16Array(width);
  const maxDistance = 82 * 82 * 3;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const dr = data[offset] - inkColor.r;
      const dg = data[offset + 1] - inkColor.g;
      const db = data[offset + 2] - inkColor.b;
      if (dr * dr + dg * dg + db * db <= maxDistance) {
        rows[y] += 1;
        columns[x] += 1;
      }
    }
  }

  const rowThreshold = Math.max(2, Math.round(width * 0.003));
  const groups = [];
  let group = null;
  for (let y = 0; y < height; y += 1) {
    const active = rows[y] >= rowThreshold && rows[y] < width * 0.9;
    if (active) {
      if (!group) group = { start: y, end: y, mass: 0 };
      group.end = y;
      group.mass += rows[y];
    } else if (group) {
      groups.push(group);
      group = null;
    }
  }
  if (group) groups.push(group);

  const minLineHeight = Math.max(2, height * 0.012);
  const maxLineHeight = height * 0.38;
  const lines = groups.filter((line) => line.end - line.start + 1 >= minLineHeight && line.end - line.start + 1 <= maxLineHeight);
  if (!lines.length) return null;

  const glyphHeight = median(lines.map((line) => line.end - line.start + 1));
  const fontPixels = glyphHeight / 0.73;
  const pitches = [];
  for (let index = 1; index < lines.length; index += 1) {
    const pitch = lines[index].start - lines[index - 1].start;
    if (pitch > glyphHeight * 0.75 && pitch < height * 0.48) pitches.push(pitch);
  }
  const lineHeight = pitches.length ? clamp(median(pitches) / fontPixels, 1, 1.5) : null;

  const columnThreshold = Math.max(1, Math.round(lines.reduce((sum, line) => sum + (line.end - line.start + 1), 0) * 0.055));
  let firstColumn = width;
  let lastColumn = -1;
  for (let x = 0; x < width; x += 1) {
    if (columns[x] >= columnThreshold) {
      firstColumn = Math.min(firstColumn, x);
      lastColumn = Math.max(lastColumn, x);
    }
  }
  const leftPadding = firstColumn;
  const rightPadding = width - lastColumn - 1;
  const alignment = Math.abs(leftPadding - rightPadding) < width * 0.12
    ? 'center'
    : leftPadding < rightPadding ? 'left' : 'right';

  return {
    fontPixels,
    lineHeight,
    align: alignment,
    lineCount: lines.length,
    glyphHeight,
  };
}

export function parseHexColor(hex) {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
}

export function drawTimestamp(ctx, region, content, style, canvasWidth, canvasHeight, stampLayout = null) {
  const x = Math.round(region.x * canvasWidth);
  const y = Math.round(region.y * canvasHeight);
  const w = Math.round(region.w * canvasWidth);
  const h = Math.round(region.h * canvasHeight);
  const normalizedContent = { ...(content ?? {}), time: formatTimeToMinutes(content?.time) };
  const lines = [normalizedContent.weekday, normalizedContent.date, normalizedContent.time, normalizedContent.address]
    .filter((line) => String(line ?? '').trim().length > 0);
  if (!lines.length || w < 1 || h < 1) return { fontSize: 0, scaled: false };
  if (stampLayout && (normalizedContent.time || normalizedContent.date || normalizedContent.weekday)) {
    return drawTimestampAroundDivider(ctx, region, normalizedContent, style, canvasWidth, canvasHeight, stampLayout);
  }

  const paddingX = Math.max(5, w * 0.035);
  const paddingY = Math.max(4, h * 0.075);
  const requestedSize = Math.max(1, canvasHeight * style.fontScale);
  const lineHeight = style.lineHeight ?? 1.2;
  ctx.save();
  ctx.font = `${style.weight ?? 600} ${requestedSize}px ${style.fontFamily ?? 'Arial, sans-serif'}`;
  const maxTextWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const widthFit = (w - paddingX * 2) / Math.max(maxTextWidth, 1);
  const heightFit = (h - paddingY * 2) / Math.max(lines.length * requestedSize * lineHeight, 1);
  const fit = Math.min(1, widthFit, heightFit);
  const fontSize = requestedSize * fit;
  ctx.font = `${style.weight ?? 600} ${fontSize}px ${style.fontFamily ?? 'Arial, sans-serif'}`;
  ctx.fillStyle = style.color ?? '#ffffff';
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = style.shadow ? 'rgba(0,0,0,.72)' : 'transparent';
  ctx.shadowBlur = style.shadow ? Math.max(1, fontSize * 0.12) : 0;
  ctx.shadowOffsetX = style.shadow ? Math.max(1, fontSize * 0.025) : 0;
  ctx.shadowOffsetY = style.shadow ? Math.max(1, fontSize * 0.035) : 0;

  const textX = style.align === 'right' ? x + w - paddingX : style.align === 'center' ? x + w / 2 : x + paddingX;
  const textY = y + paddingY;
  const baseline = fontSize * lineHeight;
  lines.forEach((line, index) => ctx.fillText(line, textX, textY + index * baseline, w - paddingX * 2));
  ctx.restore();
  return { fontSize, scaled: fit < 0.98 };
}

function drawTimestampAroundDivider(ctx, region, content, style, canvasWidth, canvasHeight, divider) {
  const x = Math.round(region.x * canvasWidth);
  const y = Math.round(region.y * canvasHeight);
  const w = Math.round(region.w * canvasWidth);
  const h = Math.round(region.h * canvasHeight);
  ctx.save();
  const dividerX = x + divider.x;
  const dividerY = y + divider.y;
  const dividerWidth = Math.max(2, divider.w);
  const dividerHeight = Math.max(12, divider.h);
  const fontFamily = style.fontFamily ?? '"Roboto Condensed", "Arial Narrow", Arial, sans-serif';
  const weight = style.weight ?? 400;
  const timeWeight = style.timeWeight ?? Math.min(700, weight + 100);
  const scale = clamp((style.fontScale ?? 0.028) / 0.028, 0.55, 1.8);
  const timeText = String(content.time ?? '');
  const dateText = String(content.date ?? '');
  const weekdayText = String(content.weekday ?? '');
  const addressText = String(content.address ?? '').replace(/\s*·\s*/g, ', ');
  const timeSample = '14:04';
  const detailSample = '22 Tháng 10, 2026';
  const weekdaySample = 'Thứ Năm';
  const addressSamples = [
    'Chợ Phú Nhuận, Cao Thắng, Thành Phố Hồ Chí Minh,',
    'P. Phú Nhuận',
  ];
  const addressSample = addressSamples[0];
  const sourceWidths = style.sourceWidths ?? {};
  const addressSourceWidths = Array.isArray(sourceWidths.address) ? sourceWidths.address : [sourceWidths.address];
  const timeGlyphHeight = dividerHeight * (style.timeGlyphScale ?? 0.95) * scale;
  const detailGlyphHeight = dividerHeight * (style.detailGlyphScale ?? 0.40) * scale;
  const addressGlyphHeight = dividerHeight * (style.addressGlyphScale ?? 0.40) * scale;
  const paddingX = Math.max(5, w * (style.textPaddingRatio ?? 0.035));
  const paddingY = Math.max(4, h * 0.075);
  const timeSize = fontSizeForGlyphHeight(ctx, timeText || timeSample, fontFamily, timeWeight, timeGlyphHeight);
  ctx.font = `${timeWeight} ${timeSize}px ${fontFamily}`;
  const timeWidthMetrics = ctx.measureText(timeText || timeSample);
  const timeInkWidth = measuredInkWidth(timeWidthMetrics);
  const timeWidthScale = Number.isFinite(sourceWidths.time)
    ? clamp(sourceWidths.time / Math.max(1, timeInkWidth), 0.65, 1.4)
    : 1;
  const sourceTimeX = Number.isFinite(style.sourcePositions?.timeX) ? style.sourcePositions.timeX : null;
  const timeBearing = Number.isFinite(Number(timeWidthMetrics.actualBoundingBoxLeft))
    ? Math.abs(Number(timeWidthMetrics.actualBoundingBoxLeft)) * timeWidthScale
    : 0;
  const timeX = sourceTimeX === null ? x + paddingX : x + sourceTimeX - timeBearing;
  const detailSize = fontSizeForGlyphHeight(ctx, detailSample, fontFamily, weight, detailGlyphHeight);
  const addressSize = fontSizeForGlyphHeight(ctx, addressSample, fontFamily, weight, addressGlyphHeight);
  const dateWidthScale = sourceWidthScale(ctx, detailSample, sourceWidths.date, fontFamily, weight, detailSize);
  const weekdayWidthScale = sourceWidthScale(ctx, weekdaySample, sourceWidths.weekday, fontFamily, weight, detailSize);
  const addressWidthScaleForSize = (fontSize, index = 0) => sourceWidthScale(
    ctx,
    addressSamples[index] ?? addressSample,
    addressSourceWidths[index] ?? addressSourceWidths[0],
    fontFamily,
    weight,
    fontSize,
  );
  const timeWidth = Math.max(1, dividerX - timeX - Math.max(4, w * 0.01));
  const detailGap = Math.max(4, w * (style.detailGapRatio ?? 0.018));
  const detailX = dividerX + dividerWidth + detailGap;
  const detailWidth = Math.max(1, x + w - paddingX - detailX);
  const lineHeightFactor = clamp((style.lineHeight ?? 1.18) / 1.18, 0.65, 1.65);
  const detailLineHeight = clamp(style.detailLineHeight ?? style.lineHeight ?? 1.18, 0.9, 1.8);
  const addressLineHeight = clamp(style.addressLineHeight ?? style.lineHeight ?? 1.08, 0.9, 1.8);
  const detailLeading = style.detailPitchScale
    ? dividerHeight * style.detailPitchScale * scale * lineHeightFactor
    : detailSize * detailLineHeight;
  const dateMetrics = getTextVerticalMetrics(ctx, dateText || detailSample, fontFamily, weight, detailSize);
  const weekdayMetrics = getTextVerticalMetrics(ctx, weekdayText || weekdaySample, fontFamily, weight, detailSize);
  const detailBlockHeight = dateText && weekdayText
    ? detailLeading + weekdayMetrics.height
    : (dateText ? dateMetrics.height : weekdayMetrics.height);
  const textTop = dividerY + Math.max(0, (dividerHeight - detailBlockHeight) / 2);
  const addressGap = dividerHeight * clamp(style.addressGapRatio ?? 0.30, 0.08, 0.75) * scale;
  const addressTop = dividerY + dividerHeight + Math.max(6, addressGap);
  const addressMaxWidth = Math.max(1, w - paddingX * 2);
  const addressAvailableHeight = Math.max(1, y + h - paddingY - addressTop);
  const addressLeadingForSize = (fontSize) => style.addressPitchScale
    ? dividerHeight * style.addressPitchScale * scale * (fontSize / addressSize) * lineHeightFactor
    : fontSize * addressLineHeight;
  let fittedAddressSize = addressSize;
  let addressLines = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    ctx.font = `${weight} ${fittedAddressSize}px ${fontFamily}`;
    const firstLineScale = addressWidthScaleForSize(fittedAddressSize, 0);
    addressLines = wrapText(ctx, addressText, addressMaxWidth / firstLineScale);
    const leading = addressLeadingForSize(fittedAddressSize);
    if (addressLines.length * leading <= addressAvailableHeight) break;
    fittedAddressSize *= addressAvailableHeight / Math.max(1, addressLines.length * leading);
  }
  const addressLineWidthScales = addressLines.map((_, index) => addressWidthScaleForSize(fittedAddressSize, index));
  const timeMetrics = getTextVerticalMetrics(ctx, timeText || timeSample, fontFamily, timeWeight, timeSize);

  ctx.fillStyle = style.color ?? '#ffffff';
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = style.shadow ? 'rgba(0,0,0,.38)' : 'transparent';
  ctx.shadowBlur = style.shadow ? Math.max(0.5, addressSize * 0.035) : 0;
  ctx.shadowOffsetX = style.shadow ? Math.max(0.25, addressSize * 0.008) : 0;
  ctx.shadowOffsetY = style.shadow ? Math.max(0.25, addressSize * 0.012) : 0;

  if (timeText) {
    ctx.font = `${timeWeight} ${timeSize}px ${fontFamily}`;
    const timeTop = dividerY + Math.max(0, (dividerHeight - timeGlyphHeight) / 2);
    fillTextHorizontallyScaled(ctx, timeText, timeX, timeTop + timeMetrics.ascent, timeWidth, timeWidthScale);
  }

  ctx.font = `${weight} ${detailSize}px ${fontFamily}`;
  if (dateText) fillTextHorizontallyScaled(ctx, dateText, detailX, textTop + dateMetrics.ascent, detailWidth, dateWidthScale);
  if (weekdayText) fillTextHorizontallyScaled(ctx, weekdayText, detailX, textTop + (dateText ? detailLeading : 0) + weekdayMetrics.ascent, detailWidth, weekdayWidthScale);

  if (addressLines.length && addressText) {
    ctx.font = `${weight} ${fittedAddressSize}px ${fontFamily}`;
    const addressLeading = addressLeadingForSize(fittedAddressSize);
    addressLines.forEach((line, index) => {
      const metrics = getTextVerticalMetrics(ctx, line, fontFamily, weight, fittedAddressSize);
      fillTextHorizontallyScaled(ctx, line, x + paddingX, addressTop + index * addressLeading + metrics.ascent, addressMaxWidth, addressLineWidthScales[index] ?? addressLineWidthScales[0] ?? 1);
    });
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  const dividerColor = divider.color
    ? `rgb(${divider.color.r}, ${divider.color.g}, ${divider.color.b})`
    : '#f2b63d';
  ctx.fillStyle = dividerColor;
  ctx.fillRect(dividerX, dividerY, dividerWidth, dividerHeight);
  ctx.restore();
  return { fontSize: timeSize, scaled: true, anchoredToDivider: true };
}

function fontSizeForGlyphHeight(ctx, text, family, weight, targetHeight) {
  const safeHeight = Math.max(1, targetHeight);
  ctx.font = `${weight} 100px ${family}`;
  const metrics = ctx.measureText(String(text || '0'));
  const measuredHeight = Number(metrics.actualBoundingBoxAscent) + Number(metrics.actualBoundingBoxDescent);
  return Number.isFinite(measuredHeight) && measuredHeight > 0
    ? safeHeight * 100 / measuredHeight
    : safeHeight / 0.70;
}

function measuredInkWidth(metrics) {
  const left = Math.abs(Number(metrics?.actualBoundingBoxLeft));
  const right = Number(metrics?.actualBoundingBoxRight);
  const inkWidth = right - left;
  if (Number.isFinite(inkWidth) && inkWidth > 0) return inkWidth;
  const advanceWidth = Number(metrics?.width);
  return Number.isFinite(advanceWidth) && advanceWidth > 0 ? advanceWidth : 1;
}

function getTextVerticalMetrics(ctx, text, family, weight, fontSize) {
  ctx.font = `${weight} ${fontSize}px ${family}`;
  const metrics = ctx.measureText(String(text || '0'));
  const ascent = Number(metrics.actualBoundingBoxAscent);
  const descent = Number(metrics.actualBoundingBoxDescent);
  if (Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0) {
    return { ascent: Math.max(0, ascent), height: ascent + descent };
  }
  return { ascent: fontSize * 0.70, height: fontSize * 0.70 };
}

function sourceWidthScale(ctx, referenceText, sourceWidth, family, weight, fontSize) {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) return 1;
  ctx.font = `${weight} ${fontSize}px ${family}`;
  const naturalWidth = ctx.measureText(referenceText).width;
  return Number.isFinite(naturalWidth) && naturalWidth > 0
    ? clamp(sourceWidth / naturalWidth, 0.65, 1.4)
    : 1;
}

function fillTextHorizontallyScaled(ctx, text, x, baseline, maxWidth, scaleX = 1) {
  const safeScale = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  if (safeScale === 1 || typeof ctx.translate !== 'function' || typeof ctx.scale !== 'function') {
    ctx.fillText(text, x, baseline, maxWidth);
    return;
  }
  ctx.save();
  ctx.translate(x, baseline);
  ctx.scale(safeScale, 1);
  ctx.fillText(text, 0, 0, maxWidth / safeScale);
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fallbackForCorner(corner, w = 0.40, h = 0.25) {
  const margin = 0.045;
  return {
    x: corner.endsWith('right') ? 1 - margin - w : margin,
    y: corner.startsWith('bottom') ? 1 - margin - h : margin,
    w,
    h,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mergeLineGroups(lines, maxHeight) {
  const blocks = [];
  for (const line of lines) {
    const current = blocks[blocks.length - 1];
    if (!current) {
      blocks.push({ ...line, rows: [...line.rows] });
      continue;
    }
    const currentHeight = current.end - current.start + 1;
    const lineHeight = line.end - line.start + 1;
    const verticalGap = line.start - current.end - 1;
    const allowedGap = Math.max(3, Math.min(maxHeight * 0.22, (currentHeight + lineHeight) * 0.65));
    if (verticalGap <= allowedGap && line.end - current.start + 1 <= maxHeight) {
      current.end = line.end;
      current.rows.push(...line.rows);
    } else {
      blocks.push({ ...line, rows: [...line.rows] });
    }
  }
  return blocks;
}

function groupNearby(values, gap) {
  const groups = [];
  for (const value of values) {
    const last = groups[groups.length - 1];
    if (!last || value - last.end > gap) groups.push({ start: value, end: value, rows: [value] });
    else {
      last.end = value;
      last.rows.push(value);
    }
  }
  return groups;
}

function luma(data, index) {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}
