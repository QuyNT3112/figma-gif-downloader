import JSZip from "jszip";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import omggif from "omggif";

export interface AnimatedLayerItem {
  nodeId: string;
  visualNodeId?: string;
  nodeName: string;
  bytes: Uint8Array;
  relX: number;
  relY: number;
  relWidth: number;
  relHeight: number;
  cornerRadius?: number;
  format: string;
  mimeType: string;
  isAnimated: boolean;
  scaleMode?: string;
}

interface ScannedFrameItem {
  id: string;
  frameId: string;
  frameName: string;
  frameWidth: number;
  frameHeight: number;
  cornerRadius: number;
  isCapsule?: boolean;
  clipsContent: boolean;
  scale: number;
  basePngBytes?: Uint8Array;
  nativeFrameGifBytes?: Uint8Array | null;

  // All animated layers in this container frame
  animatedLayers?: AnimatedLayerItem[];

  gifNodeId: string;
  gifVisualNodeId?: string;
  gifNodeName: string;
  gifBytes: Uint8Array;
  relX: number;
  relY: number;
  relWidth: number;
  relHeight: number;
  stickerCornerRadius?: number;
  scaleMode?: string;
  format: string;
  mimeType: string;
  isGif: boolean;
  isAnimated: boolean;

  // Cached Blobs & URLs
  rawGifBlobUrl?: string;
  renderedFrameBlob?: Blob;
  renderedFrameBlobUrl?: string;
  isRendering?: boolean;
}

interface ExportedSequencerFrame {
  id: string;
  name: string;
  index: number;
  width: number;
  height: number;
  bytes: Uint8Array;
  blobUrl?: string;
}

interface DecodedFrame {
  canvas: HTMLCanvasElement;
  delayMs: number;
}

// State
let allScannedItems: ScannedFrameItem[] = [];
let filteredItems: ScannedFrameItem[] = [];
let currentScope: "selection" | "page" = "selection";
let currentExportMode: "frame" | "raw" = "frame";
let currentTypeFilter: "all" | "animated" | "static" = "all";
let currentScale: number = 1; // Default to 1x (Exact Figma frame size)
let lastDebugLogs: string[] = [];

let currentSequencerFrames: ExportedSequencerFrame[] = [];
let generatedSequencerBlob: Blob | null = null;
let activeModalItem: ScannedFrameItem | null = null;

// Pending requests for Base PNG
const pendingBasePngRequests = new Map<string, (bytes: Uint8Array) => void>();

// Helpers
function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function sanitizeFilename(name: string): string {
  return (name || "export").replace(/[/\\?%*:|"<>]/g, "-").trim() || "export";
}

function showToast(message: string, duration = 3500) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>✨</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function postToFigma(msg: any) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function updateProgressBar(visible: boolean, text = "", percent = 0) {
  const banner = document.getElementById("progressBanner");
  const pText = document.getElementById("progressText");
  const fill = document.getElementById("progressBarFill");

  if (!banner) return;
  if (!visible) {
    banner.style.display = "none";
    return;
  }

  banner.style.display = "flex";
  if (pText) pText.innerText = text;
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

// Request Base PNG on demand from Figma at specific scale (hides all animated sticker nodes simultaneously)
function requestBasePng(frameId: string, gifNodeIds: string[] | string, scale: number): Promise<Uint8Array> {
  const ids = Array.isArray(gifNodeIds) ? gifNodeIds : [gifNodeIds];
  return new Promise((resolve) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const timeout = setTimeout(() => {
      if (pendingBasePngRequests.has(requestId)) {
        pendingBasePngRequests.delete(requestId);
        resolve(new Uint8Array(0));
      }
    }, 15000);

    pendingBasePngRequests.set(requestId, (bytes: Uint8Array) => {
      clearTimeout(timeout);
      resolve(bytes);
    });

    postToFigma({
      type: "GET_BASE_PNG",
      requestId,
      frameId,
      gifNodeIds: ids,
      gifNodeId: ids[0] || "",
      scale
    });
  });
}

// Universal Multi-format Animation Extractor with full GIF disposal method handling (prevents ghosting and blurriness)
async function extractAnimatedFrames(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ frames: DecodedFrame[]; width: number; height: number } | null> {
  const isGif = bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46; // "GIF"

  // Method 1: For GIFs, use omggif first (handles disposal methods 1, 2, 3 with pixel precision, zero blur or ghosting)
  if (isGif || mimeType === "image/gif") {
    try {
      const reader = new omggif.GifReader(bytes);
      const numFrames = reader.numFrames();
      if (numFrames > 1) {
        const gifW = reader.width;
        const gifH = reader.height;
        const frames: DecodedFrame[] = [];

        const pixelBuffer = new Uint8ClampedArray(gifW * gifH * 4);
        let previousFrameBackup: Uint8ClampedArray | null = null;

        for (let i = 0; i < numFrames; i++) {
          const info = reader.frameInfo(i);

          // Disposal 3: Restore to previous frame state before drawing
          if (info.disposal === 3) {
            previousFrameBackup = new Uint8ClampedArray(pixelBuffer);
          }

          // Blit current frame onto pixelBuffer
          reader.decodeAndBlitFrameRGBA(i, pixelBuffer);

          // Create pristine snapshot canvas for this frame
          const c = document.createElement("canvas");
          c.width = gifW;
          c.height = gifH;
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          const imgData = new ImageData(new Uint8ClampedArray(pixelBuffer), gifW, gifH);
          ctx.putImageData(imgData, 0, 0);

          frames.push({
            canvas: c,
            delayMs: Math.max(20, (info.delay || 10) * 10),
          });

          // Handle disposal for NEXT frame
          if (info.disposal === 2) {
            // Restore to Background (transparent): clear the subrect of current frame to prevent ghosting!
            const x0 = Math.max(0, info.x);
            const y0 = Math.max(0, info.y);
            const w = Math.min(gifW - x0, info.width);
            const h = Math.min(gifH - y0, info.height);
            for (let r = y0; r < y0 + h; r++) {
              const rowStart = (r * gifW + x0) * 4;
              const rowEnd = rowStart + w * 4;
              pixelBuffer.fill(0, rowStart, rowEnd);
            }
          } else if (info.disposal === 3 && previousFrameBackup) {
            // Restore to previous frame state
            pixelBuffer.set(previousFrameBackup);
            previousFrameBackup = null;
          }
        }

        if (frames.length > 1) {
          return { frames, width: gifW, height: gifH };
        }
      }
    } catch (e) {
      // omggif failed, fall through to ImageDecoder
    }
  }

  // Method 2: ImageDecoder (Chromium native, handles Animated WebP, APNG, and fallback for GIF)
  if (typeof (window as any).ImageDecoder !== "undefined") {
    const ImageDecoderCtor = (window as any).ImageDecoder;
    const testTypes = [mimeType, "image/gif", "image/webp", "image/png"];
    for (const testType of testTypes) {
      if (!testType) continue;
      try {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const decoder = new ImageDecoderCtor({
          data: buffer,
          type: testType,
        });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (track && track.frameCount > 1) {
          const frameCount = track.frameCount;
          const frames: DecodedFrame[] = [];
          let width = 0;
          let height = 0;

          for (let i = 0; i < frameCount; i++) {
            const res = await decoder.decode({ frameIndex: i });
            const vf = res.image;
            if (i === 0) {
              width = vf.displayWidth || vf.codedWidth;
              height = vf.displayHeight || vf.codedHeight;
            }
            const c = document.createElement("canvas");
            c.width = width;
            c.height = height;
            const ctx = c.getContext("2d")!;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(vf, 0, 0);

            // duration in microseconds
            const durMs = vf.duration ? Math.round(vf.duration / 1000) : 100;
            vf.close();

            frames.push({
              canvas: c,
              delayMs: Math.max(20, durMs || 100),
            });
          }

          if (frames.length > 1) {
            return { frames, width, height };
          }
        }
      } catch (e) {
        // Fallback to next type
      }
    }
  }

  return null;
}

// Helper to draw clean rounded rectangle path
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  if (typeof (ctx as any).roundRect === "function") {
    (ctx as any).roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

// Helper to test if pixel (x, y) is inside rounded rectangle
function isInsideRoundedRect(x: number, y: number, w: number, h: number, r: number): boolean {
  if (x < 0 || x >= w || y < 0 || y >= h) return false;
  if (r <= 0) return true;
  const maxR = Math.min(w, h) / 2;
  const clampedR = Math.min(r, maxR);
  if (x < clampedR && y < clampedR) {
    const dx = x - clampedR, dy = y - clampedR;
    return dx * dx + dy * dy <= clampedR * clampedR;
  }
  if (x >= w - clampedR && y < clampedR) {
    const dx = x - (w - clampedR), dy = y - clampedR;
    return dx * dx + dy * dy <= clampedR * clampedR;
  }
  if (x < clampedR && y >= h - clampedR) {
    const dx = x - clampedR, dy = y - (h - clampedR);
    return dx * dx + dy * dy <= clampedR * clampedR;
  }
  if (x >= w - clampedR && y >= h - clampedR) {
    const dx = x - (w - clampedR), dy = y - (h - clampedR);
    return dx * dx + dy * dy <= clampedR * clampedR;
  }
  return true;
}

// Helper to draw an image canvas with Figma scaleMode (FILL, FIT, STRETCH)
function drawImageScaled(
  ctx: CanvasRenderingContext2D,
  imgCanvas: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  scaleMode?: string
) {
  if (dw <= 0 || dh <= 0) return;
  if (!scaleMode || scaleMode === "FILL" || scaleMode === "STRETCH") {
    const imgRatio = imgCanvas.width / (imgCanvas.height || 1);
    const destRatio = dw / (dh || 1);
    // If aspect ratios are very close (within 6%), direct drawImage is faster and crisper
    if (Math.abs(imgRatio - destRatio) / destRatio < 0.06) {
      ctx.drawImage(imgCanvas, dx, dy, dw, dh);
      return;
    }
  }

  if (scaleMode === "FIT") {
    const imgRatio = imgCanvas.width / (imgCanvas.height || 1);
    const destRatio = dw / (dh || 1);
    let targetW = dw;
    let targetH = dh;
    let targetX = dx;
    let targetY = dy;
    if (imgRatio > destRatio) {
      targetH = dw / imgRatio;
      targetY = dy + (dh - targetH) / 2;
    } else {
      targetW = dh * imgRatio;
      targetX = dx + (dw - targetW) / 2;
    }
    ctx.drawImage(imgCanvas, targetX, targetY, targetW, targetH);
  } else if (scaleMode === "FILL") {
    const imgRatio = imgCanvas.width / (imgCanvas.height || 1);
    const destRatio = dw / (dh || 1);
    let sx = 0, sy = 0, sw = imgCanvas.width, sh = imgCanvas.height;
    if (imgRatio > destRatio) {
      sw = imgCanvas.height * destRatio;
      sx = (imgCanvas.width - sw) / 2;
    } else {
      sh = imgCanvas.width / destRatio;
      sy = (imgCanvas.height - sh) / 2;
    }
    ctx.drawImage(imgCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    ctx.drawImage(imgCanvas, dx, dy, dw, dh);
  }
}

// Composite Frame + GIF renderer (Crystal clear HD with multi-sticker synchronization and zero black corners)
async function renderCompositeFrameGif(
  item: ScannedFrameItem,
  onProgress?: (curr: number, total: number) => void
): Promise<Blob> {
  item.isRendering = true;

  try {
    const layersToProcess = (item.animatedLayers && item.animatedLayers.length > 0)
      ? item.animatedLayers
      : [{
          nodeId: item.gifNodeId,
          visualNodeId: item.gifVisualNodeId,
          nodeName: item.gifNodeName,
          bytes: item.gifBytes,
          relX: item.relX,
          relY: item.relY,
          relWidth: item.relWidth,
          relHeight: item.relHeight,
          cornerRadius: item.stickerCornerRadius,
          scaleMode: item.scaleMode,
          format: item.format,
          mimeType: item.mimeType,
          isAnimated: item.isAnimated
        }];

    // Collect all layer IDs (both visual container and inner fill nodes) to hide in base PNG
    const layerIds: string[] = [];
    for (const l of layersToProcess) {
      if (l.visualNodeId && !layerIds.includes(l.visualNodeId)) layerIds.push(l.visualNodeId);
      if (l.nodeId && !layerIds.includes(l.nodeId)) layerIds.push(l.nodeId);
    }
    if (layerIds.length === 0 && item.gifNodeId) layerIds.push(item.gifNodeId);

    // 1. Fetch clean base PNG from Figma at currentScale with all animated stickers hidden
    const basePngBytes = await requestBasePng(item.frameId, layerIds, currentScale);

    // 2. Load base PNG
    let baseImg: HTMLImageElement | null = null;
    if (basePngBytes && basePngBytes.length > 0) {
      const baseBlob = new Blob([basePngBytes], { type: "image/png" });
      const url = URL.createObjectURL(baseBlob);
      try {
        baseImg = await loadImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    // 3. Exact export dimensions strictly based on 1x frameWidth and currentScale
    let exportWidth = Math.max(1, Math.round(item.frameWidth * currentScale));
    let exportHeight = Math.max(1, Math.round(item.frameHeight * currentScale));

    // Ensure canvas dimensions match baseImg dimensions exactly (prevents any stretching or squashing)
    if (baseImg && baseImg.width > 0 && baseImg.height > 0) {
      exportWidth = baseImg.width;
      exportHeight = baseImg.height;
    }

    // Calculate exact corner radius for this scale
    let cornerRadius = 0;
    if (item.isCapsule) {
      // Pill capsule has radius = half height
      cornerRadius = Math.round(exportHeight / 2);
    } else if (item.cornerRadius && item.cornerRadius > 0) {
      // Exact corner radius scaled to current export scale (capped to half dimensions)
      cornerRadius = Math.min(
        Math.round(item.cornerRadius * currentScale),
        Math.floor(exportHeight / 2),
        Math.floor(exportWidth / 2)
      );
    }

    // 4. Extract animated frames for all layers
    interface ExtractedLayer {
      nodeId: string;
      frames: DecodedFrame[];
      totalDuration: number;
      drawX: number;
      drawY: number;
      drawW: number;
      drawH: number;
      cornerRadius?: number;
      scaleMode?: string;
    }

    const loadedLayers: ExtractedLayer[] = [];

    // Scale factors strictly lockstep with baseImg to prevent any rounding drift or distortion
    const scaleX = (baseImg && item.frameWidth > 0) ? (baseImg.width / item.frameWidth) : currentScale;
    const scaleY = (baseImg && item.frameHeight > 0) ? (baseImg.height / item.frameHeight) : currentScale;

    for (const l of layersToProcess) {
      const animData = await extractAnimatedFrames(l.bytes, l.mimeType || "image/gif");
      if (animData && animData.frames.length > 0) {
        const drawX = Math.round(l.relX * scaleX);
        const drawY = Math.round(l.relY * scaleY);
        const drawW = Math.round(l.relWidth * scaleX);
        const drawH = Math.round(l.relHeight * scaleY);
        const totalDuration = animData.frames.reduce((s, f) => s + f.delayMs, 0) || (animData.frames.length * 100);

        loadedLayers.push({
          nodeId: l.nodeId,
          frames: animData.frames,
          totalDuration,
          drawX,
          drawY,
          drawW,
          drawH,
          cornerRadius: l.cornerRadius,
          scaleMode: l.scaleMode || item.scaleMode || "FILL"
        });
      }
    }

    if (loadedLayers.length > 0) {
      item.isGif = true;
      item.isAnimated = true;

      const compCanvas = document.createElement("canvas");
      compCanvas.width = exportWidth;
      compCanvas.height = exportHeight;
      const cCtx = compCanvas.getContext("2d", { willReadFrequently: true })!;
      cCtx.imageSmoothingEnabled = true;
      cCtx.imageSmoothingQuality = "high";

      const encoder = GIFEncoder();

      function getFrameAtTime(layer: ExtractedLayer, timeMs: number): DecodedFrame {
        const t = timeMs % layer.totalDuration;
        let acc = 0;
        for (const f of layer.frames) {
          acc += f.delayMs;
          if (t < acc) return f;
        }
        return layer.frames[layer.frames.length - 1];
      }

      function processAndWriteFrame(delayMs: number, isFirst: boolean) {
        const imgData = cCtx.getImageData(0, 0, exportWidth, exportHeight);
        const data = imgData.data;

        // 1. Mathematical Rounded Rectangle Mask:
        // Force every single pixel outside the rounded rectangle / capsule to pure transparent [0, 0, 0, 0]!
        // This completely eliminates any possibility of black corners!
        if (cornerRadius > 0) {
          for (let y = 0; y < exportHeight; y++) {
            for (let x = 0; x < exportWidth; x++) {
              if (!isInsideRoundedRect(x, y, exportWidth, exportHeight, cornerRadius)) {
                const idx = (y * exportWidth + x) * 4;
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
              }
            }
          }
        }

        // 2. 1-bit alpha threshold and detect if any pixel is transparent
        let hasAlpha = false;
        for (let p = 0; p < data.length; p += 4) {
          if (data[p + 3] < 128) {
            data[p] = 0;
            data[p + 1] = 0;
            data[p + 2] = 0;
            data[p + 3] = 0;
            hasAlpha = true;
          } else {
            data[p + 3] = 255;
          }
        }

        if (hasAlpha) {
          const palette = quantize(data, 256, { format: "rgba4444", oneBitAlpha: true });
          let transparentIndex = palette.findIndex((c: number[]) => c.length >= 4 && c[3] === 0);
          if (transparentIndex === -1) {
            palette[0] = [0, 0, 0, 0];
            transparentIndex = 0;
          }
          const index = applyPalette(data, palette, "rgba4444");

          encoder.writeFrame(index, exportWidth, exportHeight, {
            palette,
            delay: delayMs,
            repeat: isFirst ? 0 : undefined,
            transparent: true,
            transparentIndex: transparentIndex
          });
        } else {
          // Sharp rectangular GIF without transparency: use rgb565 for maximum color quality!
          const palette = quantize(data, 256, { format: "rgb565" });
          const index = applyPalette(data, palette, "rgb565");

          encoder.writeFrame(index, exportWidth, exportHeight, {
            palette,
            delay: delayMs,
            repeat: isFirst ? 0 : undefined
          });
        }
      }

      if (loadedLayers.length === 1) {
        // Single animated layer
        const singleLayer = loadedLayers[0];
        const numFrames = singleLayer.frames.length;

        for (let i = 0; i < numFrames; i++) {
          const frame = singleLayer.frames[i];
          cCtx.clearRect(0, 0, exportWidth, exportHeight);

          if (cornerRadius > 0) {
            cCtx.save();
            drawRoundedRect(cCtx, 0, 0, exportWidth, exportHeight, cornerRadius);
            cCtx.clip();
          } else if (item.clipsContent) {
            cCtx.save();
            cCtx.rect(0, 0, exportWidth, exportHeight);
            cCtx.clip();
          }

          if (baseImg) {
            cCtx.drawImage(baseImg, 0, 0, exportWidth, exportHeight);
          }

          if (singleLayer.cornerRadius && singleLayer.cornerRadius > 0) {
            cCtx.save();
            drawRoundedRect(cCtx, singleLayer.drawX, singleLayer.drawY, singleLayer.drawW, singleLayer.drawH, Math.round(singleLayer.cornerRadius * scaleX));
            cCtx.clip();
            drawImageScaled(
              cCtx,
              frame.canvas,
              singleLayer.drawX,
              singleLayer.drawY,
              singleLayer.drawW,
              singleLayer.drawH,
              singleLayer.scaleMode
            );
            cCtx.restore();
          } else {
            drawImageScaled(
              cCtx,
              frame.canvas,
              singleLayer.drawX,
              singleLayer.drawY,
              singleLayer.drawW,
              singleLayer.drawH,
              singleLayer.scaleMode
            );
          }

          if (cornerRadius > 0 || item.clipsContent) {
            cCtx.restore();
          }

          processAndWriteFrame(frame.delayMs, i === 0);
          if (onProgress) onProgress(i + 1, numFrames);
        }
      } else {
        // Multiple animated layers: synchronized composite timeline
        const allDelays = loadedLayers.flatMap((l) => l.frames.map((f) => f.delayMs)).filter((d) => d >= 20);
        const stepDelay = Math.max(40, Math.min(100, allDelays.length > 0 ? Math.min(...allDelays) : 60));
        const maxDuration = Math.max(...loadedLayers.map((l) => l.totalDuration));
        const masterDuration = Math.min(4000, Math.max(800, maxDuration));
        const numMasterFrames = Math.max(2, Math.round(masterDuration / stepDelay));

        for (let i = 0; i < numMasterFrames; i++) {
          const timeMs = i * stepDelay;
          cCtx.clearRect(0, 0, exportWidth, exportHeight);

          if (cornerRadius > 0) {
            cCtx.save();
            drawRoundedRect(cCtx, 0, 0, exportWidth, exportHeight, cornerRadius);
            cCtx.clip();
          } else if (item.clipsContent) {
            cCtx.save();
            cCtx.rect(0, 0, exportWidth, exportHeight);
            cCtx.clip();
          }

          if (baseImg) {
            cCtx.drawImage(baseImg, 0, 0, exportWidth, exportHeight);
          }

          for (const layer of loadedLayers) {
            const f = getFrameAtTime(layer, timeMs);
            if (layer.cornerRadius && layer.cornerRadius > 0) {
              cCtx.save();
              drawRoundedRect(cCtx, layer.drawX, layer.drawY, layer.drawW, layer.drawH, Math.round(layer.cornerRadius * scaleX));
              cCtx.clip();
              drawImageScaled(
                cCtx,
                f.canvas,
                layer.drawX,
                layer.drawY,
                layer.drawW,
                layer.drawH,
                layer.scaleMode
              );
              cCtx.restore();
            } else {
              drawImageScaled(
                cCtx,
                f.canvas,
                layer.drawX,
                layer.drawY,
                layer.drawW,
                layer.drawH,
                layer.scaleMode
              );
            }
          }

          if (cornerRadius > 0 || item.clipsContent) {
            cCtx.restore();
          }

          processAndWriteFrame(stepDelay, i === 0);
          if (onProgress) onProgress(i + 1, numMasterFrames);
        }
      }

      encoder.finish();
      const outBytes = encoder.bytes();
      const resultBlob = new Blob([outBytes], { type: "image/gif" });
      item.renderedFrameBlob = resultBlob;
      item.renderedFrameBlobUrl = URL.createObjectURL(resultBlob);
      return resultBlob;
    }

    // Fallback: Return base frame PNG as blob if single-frame
    if (basePngBytes && basePngBytes.length > 0) {
      const resultBlob = new Blob([basePngBytes], { type: "image/png" });
      item.renderedFrameBlob = resultBlob;
      item.renderedFrameBlobUrl = URL.createObjectURL(resultBlob);
      return resultBlob;
    }

    // Ultimate fallback: raw sticker image
    const rawBlob = new Blob([item.gifBytes], { type: item.mimeType || "image/png" });
    return rawBlob;
  } catch (err) {
    console.warn("Composite frame render error:", err);
    return new Blob([item.gifBytes], { type: item.mimeType || "image/png" });
  } finally {
    item.isRendering = false;
  }
}

// Tab Switching
function initTabs() {
  const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-btn");
  const tabContents = document.querySelectorAll<HTMLDivElement>(".tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetContent = document.getElementById(targetId || "");
      if (targetContent) {
        targetContent.classList.add("active");
      }
    });
  });
}

// Controls
function initControls() {
  const btnSelection = document.getElementById("scopeSelectionBtn") as HTMLButtonElement;
  const btnPage = document.getElementById("scopePageBtn") as HTMLButtonElement;
  const btnScan = document.getElementById("btnScan") as HTMLButtonElement;
  const exportModeSelect = document.getElementById("exportModeSelect") as HTMLSelectElement;
  const exportScaleSelect = document.getElementById("exportScaleSelect") as HTMLSelectElement;
  const typeFilterSelect = document.getElementById("typeFilterSelect") as HTMLSelectElement;
  const searchInput = document.getElementById("searchInput") as HTMLInputElement;
  const searchClearBtn = document.getElementById("searchClearBtn") as HTMLButtonElement;

  if (exportScaleSelect) {
    currentScale = Number(exportScaleSelect.value) || 1;
  }

  btnSelection?.addEventListener("click", () => {
    btnSelection.classList.add("active");
    btnPage.classList.remove("active");
    currentScope = "selection";
    doScan();
  });

  btnPage?.addEventListener("click", () => {
    btnPage.classList.add("active");
    btnSelection.classList.remove("active");
    currentScope = "page";
    doScan();
  });

  btnScan?.addEventListener("click", () => {
    doScan();
  });

  exportModeSelect?.addEventListener("change", () => {
    currentExportMode = exportModeSelect.value as any;
    applyFilterAndRender();
  });

  exportScaleSelect?.addEventListener("change", () => {
    currentScale = Number(exportScaleSelect.value) || 1;
    // Invalidate cached renders so they re-render at new HD scale
    allScannedItems.forEach(item => {
      item.basePngBytes = undefined;
      item.renderedFrameBlob = undefined;
      item.renderedFrameBlobUrl = undefined;
    });
    applyFilterAndRender();
  });

  typeFilterSelect?.addEventListener("change", () => {
    currentTypeFilter = typeFilterSelect.value as any;
    applyFilterAndRender();
  });

  searchInput?.addEventListener("input", () => {
    if (searchClearBtn) {
      searchClearBtn.style.display = searchInput.value ? "block" : "none";
    }
    applyFilterAndRender();
  });

  searchClearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    searchClearBtn.style.display = "none";
    applyFilterAndRender();
  });
}

function doScan() {
  const scanIcon = document.getElementById("scanIcon");
  if (scanIcon) scanIcon.innerText = "⏳";
  const btnScan = document.getElementById("btnScan") as HTMLButtonElement;
  if (btnScan) btnScan.disabled = true;

  const statsLabel = document.getElementById("statsLabel");
  if (statsLabel) statsLabel.innerText = "Đang quét các layer trên Figma...";

  postToFigma({
    type: "SCAN_IMAGES",
    scope: currentScope,
    scale: currentScale,
  });
}

// Filter and Render
function applyFilterAndRender() {
  const searchInput = document.getElementById("searchInput") as HTMLInputElement;
  const query = (searchInput?.value || "").toLowerCase().trim();

  filteredItems = allScannedItems.filter((item) => {
    // 1. Text filter
    if (query) {
      const matchFrame = item.frameName.toLowerCase().includes(query);
      const matchGif = item.gifNodeName.toLowerCase().includes(query);
      if (!matchFrame && !matchGif) return false;
    }

    // 2. Type filter
    if (currentTypeFilter === "animated") {
      return item.isGif || item.isAnimated;
    } else if (currentTypeFilter === "static") {
      return !item.isGif && !item.isAnimated;
    }

    return true;
  });

  renderCards(filteredItems);
  updateStats();
}

function updateStats() {
  const statsLabel = document.getElementById("statsLabel");
  const btnDownloadZip = document.getElementById("btnDownloadZip") as HTMLButtonElement;
  const searchInput = document.getElementById("searchInput") as HTMLInputElement;
  const query = (searchInput?.value || "").trim();

  const totalAnimated = allScannedItems.filter((i) => i.isGif || i.isAnimated).length;

  if (statsLabel) {
    if (filteredItems.length === 0) {
      if (allScannedItems.length > 0) {
        statsLabel.innerHTML = `Tìm thấy ${allScannedItems.length} mục (${totalAnimated} hoạt ảnh), nhưng không khớp bộ lọc. <a href="#" id="linkResetFilter" style="color: var(--accent); text-decoration: underline;">Xóa lọc</a>`;
        document.getElementById("linkResetFilter")?.addEventListener("click", (e) => {
          e.preventDefault();
          if (searchInput) searchInput.value = "";
          const clearBtn = document.getElementById("searchClearBtn");
          if (clearBtn) clearBtn.style.display = "none";
          const typeSelect = document.getElementById("typeFilterSelect") as HTMLSelectElement;
          if (typeSelect) typeSelect.value = "all";
          currentTypeFilter = "all";
          applyFilterAndRender();
        });
      } else {
        statsLabel.innerText = "Không tìm thấy layer nào chứa ảnh hoặc GIF.";
      }
    } else {
      statsLabel.innerText = `Tìm thấy ${filteredItems.length} Frame widget (${totalAnimated} ảnh động/GIF)`;
    }
  }

  if (btnDownloadZip) {
    btnDownloadZip.disabled = filteredItems.length === 0;
    btnDownloadZip.innerText =
      currentExportMode === "frame"
        ? `📦 Xuất tất cả (${filteredItems.length}) Frame (ZIP)`
        : `📦 Tải tất cả (${filteredItems.length}) file GIF rời (ZIP)`;
  }
}

function renderCards(items: ScannedFrameItem[]) {
  const container = document.getElementById("cardsContainer");
  if (!container) return;

  container.innerHTML = "";

  if (items.length === 0) {
    let debugHtml = "";
    if (lastDebugLogs.length > 0) {
      debugHtml = `
        <div style="margin-top: 10px; font-size: 11px; text-align: left; background: #1a1a22; padding: 10px 12px; border-radius: 6px; border: 1px solid #333; max-height: 200px; overflow-y: auto; width: 100%;">
          <div style="font-weight: 600; color: #0d99ff; margin-bottom: 6px; display: flex; justify-content: space-between;">
            <span>📋 Nhật ký quét từ Figma:</span>
            <span style="color: var(--text-dim);">${lastDebugLogs.length} dòng</span>
          </div>
          ${lastDebugLogs.map((l) => `<div style="font-family: monospace; font-size: 10.5px; line-height: 1.5; color: ${l.startsWith("✔") ? "#10b981" : l.startsWith("❌") ? "#ef4444" : "#9ca3af"};">${l}</div>`).join("")}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Không tìm thấy Frame nào</div>
        <div class="empty-desc">
          ${
            currentScope === "selection"
              ? "Hãy chọn các Frame widget (như 37, 42, 39...) hoặc bấm <b>'Toàn bộ trang'</b> để tự động quét toàn bộ Section."
              : "Không tìm thấy Frame nào chứa ảnh hoặc GIF trên trang này."
          }
        </div>
        ${debugHtml}
      </div>
    `;
    return;
  }

  items.forEach((item) => {
    // Generate raw animated Blob URL for immediate playback in browser
    if (!item.rawGifBlobUrl) {
      const mime = item.mimeType || (item.isGif ? "image/gif" : "image/png");
      const blob = new Blob([item.gifBytes], { type: mime });
      item.rawGifBlobUrl = URL.createObjectURL(blob);
    }

    const card = document.createElement("div");
    card.className = "frame-card";

    const isAnim = item.isGif || item.isAnimated;
    const formatBadge = isAnim
      ? `<span class="pill" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);">✨ ${item.format.includes("Động") ? item.format : item.format + " ĐỘNG"}</span>`
      : `<span class="pill" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);">${item.format}</span>`;

    const forceAnimBtn = !isAnim
      ? `<button class="btn btn-secondary btn-force-anim" style="padding: 2px 7px; font-size: 10px; margin-top: 2px;" title="Thử phân tích sâu lại hoạt ảnh">⚡ Ép nhận GIF</button>`
      : "";

    card.innerHTML = `
      <div class="preview-container" id="preview_${item.id}" title="Bấm để xem kích thước lớn">
        <img class="preview-img" id="img_${item.id}" src="${item.rawGifBlobUrl}" alt="${item.frameName}">
      </div>
      <div class="card-info">
        <div class="card-title-row">
          <span class="pill pill-frame">Frame</span>
          <span class="card-title" title="${item.frameName}">${item.frameName}</span>
          ${formatBadge}
        </div>
        <div class="card-subtitle" title="Layer: ${item.gifNodeName}">
          Layer: ${item.gifNodeName}
        </div>
        <div class="card-meta">
          <span class="pill pill-size">${item.frameWidth * currentScale} × ${item.frameHeight * currentScale} px (HD)</span>
          <span class="pill pill-size">${formatBytes(item.gifBytes.length)}</span>
        </div>
      </div>
      <div class="card-actions">
        <div class="action-row">
          <button class="btn-icon btn-locate" title="Chuyển đến Frame này trên Canvas">
            🎯
          </button>
          <button class="btn-icon btn-preview" title="Xem trước hoạt ảnh lớn">
            👁️
          </button>
        </div>
        <button class="btn btn-primary btn-dl-frame" style="padding: 5px 9px; font-size: 11px;">
          🎬 Xuất cả Frame
        </button>
        <button class="btn btn-secondary btn-dl-raw" style="padding: 3px 8px; font-size: 10px; margin-top: -2px;">
          📦 Lấy GIF rời
        </button>
        ${forceAnimBtn}
      </div>
    `;

    // Locate Frame on Canvas
    card.querySelector(".btn-locate")?.addEventListener("click", () => {
      postToFigma({
        type: "FOCUS_NODE",
        nodeId: item.frameId,
      });
    });

    // Preview in Modal
    const openPreview = () => openModal(item);
    card.querySelector(".preview-container")?.addEventListener("click", openPreview);
    card.querySelector(".btn-preview")?.addEventListener("click", openPreview);

    // Force Animation Check button
    card.querySelector(".btn-force-anim")?.addEventListener("click", async () => {
      const btnForce = card.querySelector(".btn-force-anim") as HTMLButtonElement;
      btnForce.disabled = true;
      btnForce.innerText = "⏳ Đang phân tích...";

      const anim = await extractAnimatedFrames(item.gifBytes, item.mimeType || "image/gif");
      if (anim && anim.frames.length > 0) {
        item.isGif = true;
        item.isAnimated = true;
        item.format = "GIF (Đã nhận diện)";
        showToast(`Đã nhận diện thành công: ${anim.frames.length} frame hoạt ảnh!`);
      } else {
        item.isGif = true;
        item.isAnimated = true;
        item.format = "GIF (Ép hoạt ảnh)";
        showToast("Đã bật chế độ hoạt ảnh GIF cho Frame này!");
      }
      applyFilterAndRender();
    });

    // Download Whole Frame (On demand!)
    card.querySelector(".btn-dl-frame")?.addEventListener("click", async () => {
      const btn = card.querySelector(".btn-dl-frame") as HTMLButtonElement;
      btn.disabled = true;
      btn.innerText = "⏳ Đang chuẩn bị...";

      try {
        const blob = await renderCompositeFrameGif(item, (curr, total) => {
          btn.innerText = `⏳ ${curr}/${total}`;
        });
        const ext = (item.isGif || item.isAnimated) ? "gif" : "png";
        triggerDownload(blob, `${sanitizeFilename(item.frameName)}.${ext}`);
        showToast(`Đã xuất Frame: ${item.frameName}.${ext}`);

        // Update card preview thumbnail to the full rendered frame
        const cardImg = card.querySelector(".preview-img") as HTMLImageElement;
        if (cardImg && item.renderedFrameBlobUrl) {
          cardImg.src = item.renderedFrameBlobUrl;
        }
      } catch (err: any) {
        console.error("Frame render error:", err);
        showToast("Lỗi khi xuất Frame: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = "🎬 Xuất cả Frame";
      }
    });

    // Download Isolated GIF (Instant!)
    card.querySelector(".btn-dl-raw")?.addEventListener("click", () => {
      const isAnim = item.isGif || item.isAnimated;
      const ext = isAnim ? "gif" : (item.format.toLowerCase().includes("webp") ? "webp" : "png");
      const mime = isAnim ? "image/gif" : (item.mimeType || "image/png");
      const blob = new Blob([item.gifBytes], { type: mime });
      triggerDownload(blob, `${sanitizeFilename(item.gifNodeName || item.frameName)}.${ext}`);
      showToast(`Đã tải file ảnh: ${item.gifNodeName}.${ext}`);
    });

    container.appendChild(card);
  });
}

// Modal handling
function initModal() {
  const modal = document.getElementById("previewModal");
  const btnClose = document.getElementById("btnCloseModal");
  const btnDownload = document.getElementById("btnModalDownload");

  btnClose?.addEventListener("click", () => {
    modal?.classList.remove("active");
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("active");
  });

  btnDownload?.addEventListener("click", async () => {
    if (activeModalItem) {
      const isAnim = activeModalItem.isGif || activeModalItem.isAnimated;
      const ext = isAnim ? "gif" : "png";
      btnDownload.innerText = "⏳ Đang xuất...";
      try {
        const blob = await renderCompositeFrameGif(activeModalItem);
        triggerDownload(blob, `${sanitizeFilename(activeModalItem.frameName)}.${ext}`);
        showToast(`Đã xuất Frame: ${activeModalItem.frameName}.${ext}`);
        modal?.classList.remove("active");
      } catch (err: any) {
        showToast("Lỗi xuất: " + err.message);
      } finally {
        btnDownload.innerText = "🎬 Xuất Frame GIF";
      }
    }
  });
}

function openModal(item: ScannedFrameItem) {
  activeModalItem = item;
  const modal = document.getElementById("previewModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalImg = document.getElementById("modalImg") as HTMLImageElement;
  const modalMeta = document.getElementById("modalMeta");

  if (modalTitle) modalTitle.innerText = `Xem trước: ${item.frameName}`;
  if (modalImg) {
    modalImg.src = item.renderedFrameBlobUrl || item.rawGifBlobUrl || "";
  }
  if (modalMeta) {
    modalMeta.innerText = `Kích thước: ${item.frameWidth * currentScale} × ${item.frameHeight * currentScale} px | Layer: ${item.gifNodeName} (${item.format})`;
  }

  modal?.classList.add("active");

  // Auto-render full composite frame in modal if not yet rendered
  if (!item.renderedFrameBlobUrl && !item.isRendering) {
    if (modalMeta) {
      modalMeta.innerText = `⏳ Đang kết xuất toàn bộ Frame... | Kích thước: ${item.frameWidth * currentScale} × ${item.frameHeight * currentScale} px`;
    }
    renderCompositeFrameGif(item).then((blob) => {
      if (activeModalItem?.id === item.id && modalImg) {
        modalImg.src = item.renderedFrameBlobUrl || URL.createObjectURL(blob);
        if (modalMeta) {
          modalMeta.innerText = `Kích thước: ${item.frameWidth * currentScale} × ${item.frameHeight * currentScale} px | Layer: ${item.gifNodeName} (${item.format})`;
        }
      }
      const cardImg = document.getElementById(`img_${item.id}`) as HTMLImageElement;
      if (cardImg && item.renderedFrameBlobUrl) {
        cardImg.src = item.renderedFrameBlobUrl;
      }
    }).catch((err) => console.warn("Modal auto-render error:", err));
  }
}

// Sequential Batch ZIP Download (Zero freezing!)
function initBatchDownload() {
  const btnZip = document.getElementById("btnDownloadZip") as HTMLButtonElement;

  btnZip?.addEventListener("click", async () => {
    if (filteredItems.length === 0) return;

    btnZip.disabled = true;
    btnZip.innerText = "⏳ Đang chuẩn bị...";
    updateProgressBar(true, "Chuẩn bị nén ZIP...", 0);

    try {
      const zip = new JSZip();
      const folderName = currentExportMode === "frame" ? "figma-frame-widgets" : "figma-raw-gifs";
      const folder = zip.folder(folderName);

      for (let i = 0; i < filteredItems.length; i++) {
        const item = filteredItems[i];
        const progressPct = Math.round(((i + 1) / filteredItems.length) * 100);
        updateProgressBar(
          true,
          `Đang xử lý ${i + 1}/${filteredItems.length}: ${item.frameName}...`,
          progressPct
        );

        if (currentExportMode === "frame") {
          const blob = await renderCompositeFrameGif(item);
          const isAnim = item.isGif || item.isAnimated;
          const ext = isAnim ? "gif" : "png";
          folder?.file(`${sanitizeFilename(item.frameName)}.${ext}`, blob);
        } else {
          const isAnim = item.isGif || item.isAnimated;
          const ext = isAnim ? "gif" : (item.format.toLowerCase().includes("webp") ? "webp" : "png");
          folder?.file(`${sanitizeFilename(item.gifNodeName || item.frameName)}.${ext}`, item.gifBytes);
        }
      }

      updateProgressBar(true, "Đang đóng gói file ZIP...", 100);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      triggerDownload(zipBlob, `${folderName}-${new Date().toISOString().slice(0, 10)}.zip`);
      showToast(`Đã xuất ZIP thành công (${filteredItems.length} file)!`);
    } catch (err: any) {
      console.error("ZIP Error:", err);
      showToast("Lỗi khi tạo file ZIP: " + err.message);
    } finally {
      btnZip.disabled = false;
      updateStats();
      setTimeout(() => updateProgressBar(false), 1500);
    }
  });
}

// Sequencer Tab Logic
function initSequencer() {
  const btnFetchFrames = document.getElementById("btnFetchFrames") as HTMLButtonElement;
  const btnGenerate = document.getElementById("btnGenerateGif") as HTMLButtonElement;
  const seqFpsSelect = document.getElementById("seqFpsSelect") as HTMLSelectElement;
  const seqScaleSelect = document.getElementById("seqScaleSelect") as HTMLSelectElement;
  const framesStrip = document.getElementById("framesStrip");
  const framesCountLabel = document.getElementById("framesCountLabel");
  const resultCard = document.getElementById("sequencerResultCard");
  const generatedGifPreview = document.getElementById("generatedGifPreview") as HTMLImageElement;
  const generatedGifMeta = document.getElementById("generatedGifMeta");
  const btnDownloadGenerated = document.getElementById("btnDownloadGeneratedGif") as HTMLButtonElement;

  btnFetchFrames?.addEventListener("click", () => {
    const scale = parseFloat(seqScaleSelect?.value || "1");
    btnFetchFrames.disabled = true;
    btnFetchFrames.innerText = "⏳ Đang lấy frame từ canvas...";
    postToFigma({
      type: "FETCH_FRAMES_FOR_GIF",
      scale: scale,
    });
  });

  btnGenerate?.addEventListener("click", async () => {
    if (currentSequencerFrames.length < 2) {
      showToast("Cần ít nhất 2 frames để tạo ảnh động GIF.");
      return;
    }

    btnGenerate.disabled = true;
    btnGenerate.innerText = "⏳ Đang ghép GIF...";

    try {
      const fps = parseInt(seqFpsSelect?.value || "12", 10);
      const delayMs = Math.round(1000 / fps);

      const firstFrame = currentSequencerFrames[0];
      const targetWidth = firstFrame.width;
      const targetHeight = firstFrame.height;

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const encoder = GIFEncoder();

      for (let i = 0; i < currentSequencerFrames.length; i++) {
        btnGenerate.innerText = `⏳ Xử lý frame ${i + 1}/${currentSequencerFrames.length}...`;
        const frame = currentSequencerFrames[i];
        const blob = new Blob([frame.bytes], { type: "image/png" });
        const objUrl = URL.createObjectURL(blob);
        const img = await loadImage(objUrl);
        URL.revokeObjectURL(objUrl);

        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imgData.data;

        let hasAlpha = false;
        for (let p = 3; p < data.length; p += 4) {
          if (data[p] < 250) {
            hasAlpha = true;
            break;
          }
        }

        if (hasAlpha) {
          for (let p = 0; p < data.length; p += 4) {
            if (data[p + 3] < 128) {
              data[p] = 0; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 0;
            } else {
              data[p + 3] = 255;
            }
          }
          const palette = quantize(data, 256, { format: "rgba4444", oneBitAlpha: true });
          const transparentIndex = palette.findIndex((c: number[]) => c.length >= 4 && c[3] === 0);
          const index = applyPalette(data, palette, "rgba4444");

          encoder.writeFrame(index, targetWidth, targetHeight, {
            palette,
            delay: delayMs,
            repeat: i === 0 ? 0 : undefined,
            transparent: transparentIndex !== -1,
            transparentIndex: transparentIndex !== -1 ? transparentIndex : 0
          });
        } else {
          const palette = quantize(data, 256, { format: "rgb565" });
          const index = applyPalette(data, palette, "rgb565");

          encoder.writeFrame(index, targetWidth, targetHeight, {
            palette,
            delay: delayMs,
            repeat: i === 0 ? 0 : undefined
          });
        }
      }

      encoder.finish();
      const outputBytes = encoder.bytes();
      generatedSequencerBlob = new Blob([outputBytes], { type: "image/gif" });
      const previewUrl = URL.createObjectURL(generatedSequencerBlob);

      if (generatedGifPreview) {
        generatedGifPreview.src = previewUrl;
      }
      if (generatedGifMeta) {
        generatedGifMeta.innerText = `${targetWidth} × ${targetHeight} px | ${currentSequencerFrames.length} frames @ ${fps} FPS | ${formatBytes(outputBytes.length)}`;
      }
      if (resultCard) {
        resultCard.style.display = "flex";
      }

      showToast("Tạo ảnh GIF thành công!");
    } catch (err: any) {
      console.error("Frame GIF error:", err);
      showToast("Lỗi tạo GIF: " + err.message);
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.innerText = "🎬 Xuất Hoạt Ảnh GIF";
    }
  });

  btnDownloadGenerated?.addEventListener("click", () => {
    if (generatedSequencerBlob) {
      triggerDownload(generatedSequencerBlob, `animated-sequence-${Date.now()}.gif`);
      showToast("Đã tải hoạt ảnh GIF về máy!");
    }
  });
}

// Window Message Listener
window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === "SELECTION_STATUS") {
    const selText = document.getElementById("selectionText");
    if (selText) {
      if (msg.count === 0) {
        selText.innerText = "Chưa chọn layer nào (quét toàn bộ trang)";
      } else {
        selText.innerText = `Đã chọn: ${msg.count} layer (${msg.names.slice(0, 2).join(", ")}${msg.names.length > 2 ? "..." : ""})`;
      }
    }
  } else if (msg.type === "SCAN_PROGRESS") {
    const statsLabel = document.getElementById("statsLabel");
    if (statsLabel) {
      statsLabel.innerText = `Đang quét: ${msg.current}/${msg.total} (${msg.frameName || ""} > ${msg.layerName || ""})...`;
    }
    const percent = Math.round((msg.current / msg.total) * 100);
    updateProgressBar(true, `Quét Figma: ${msg.current}/${msg.total}...`, percent);
  } else if (msg.type === "SCAN_RESULTS") {
    const scanIcon = document.getElementById("scanIcon");
    if (scanIcon) scanIcon.innerText = "⚡";
    const btnScan = document.getElementById("btnScan") as HTMLButtonElement;
    if (btnScan) btnScan.disabled = false;

    updateProgressBar(false);

    if (msg.warning) {
      showToast(msg.warning);
    }

    lastDebugLogs = msg.debugLogs || [];
    allScannedItems = msg.items || [];
    applyFilterAndRender();
  } else if (msg.type === "BASE_PNG_RESULT") {
    const callback = pendingBasePngRequests.get(msg.requestId);
    if (callback) {
      pendingBasePngRequests.delete(msg.requestId);
      callback(msg.basePngBytes || new Uint8Array(0));
    }
  } else if (msg.type === "FRAMES_EXPORT_SUCCESS") {
    const btnFetch = document.getElementById("btnFetchFrames") as HTMLButtonElement;
    const btnGenerate = document.getElementById("btnGenerateGif") as HTMLButtonElement;
    const framesStrip = document.getElementById("framesStrip");
    const countLabel = document.getElementById("framesCountLabel");

    if (btnFetch) {
      btnFetch.disabled = false;
      btnFetch.innerText = "🔄 Lấy các Frame đang chọn";
    }

    currentSequencerFrames = msg.frames || [];
    if (countLabel) countLabel.innerText = String(currentSequencerFrames.length);

    if (framesStrip) {
      framesStrip.innerHTML = "";
      currentSequencerFrames.forEach((frame) => {
        const blob = new Blob([frame.bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        frame.blobUrl = url;

        const thumb = document.createElement("div");
        thumb.className = "frame-thumb";
        thumb.title = `${frame.name} (${frame.width}x${frame.height})`;
        thumb.innerHTML = `
          <img src="${url}">
          <span class="frame-num">${frame.index}</span>
        `;
        framesStrip.appendChild(thumb);
      });
    }

    if (btnGenerate) {
      btnGenerate.disabled = currentSequencerFrames.length < 2;
    }

    showToast(`Đã lấy ${currentSequencerFrames.length} frame thành công!`);
  } else if (msg.type === "FRAMES_EXPORT_ERROR") {
    const btnFetch = document.getElementById("btnFetchFrames") as HTMLButtonElement;
    if (btnFetch) {
      btnFetch.disabled = false;
      btnFetch.innerText = "🔄 Lấy các Frame đang chọn";
    }
    showToast(msg.message || "Lỗi khi lấy frames.");
  } else if (msg.type === "ERROR") {
    const scanIcon = document.getElementById("scanIcon");
    if (scanIcon) scanIcon.innerText = "⚡";
    const btnScan = document.getElementById("btnScan") as HTMLButtonElement;
    if (btnScan) btnScan.disabled = false;
    updateProgressBar(false);
    showToast(msg.message || "Lỗi xảy ra trong Figma.");
  }
};

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initControls();
  initModal();
  initBatchDownload();
  initSequencer();

  postToFigma({ type: "INIT" });
  doScan();
});
