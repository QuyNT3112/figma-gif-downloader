// Figma GIF Downloader & Frame Exporter - Fast Multi-format Scanner & On-Demand Exporter

figma.showUI(__html__, {
  width: 500,
  height: 690,
  themeColors: true,
  title: "GIF Downloader & Frame Exporter PRO"
});

export interface FormatInfo {
  isGif: boolean;
  isAnimated: boolean;
  format: string;
  mimeType: string;
}

// Detect image/GIF/WebP/APNG/video format from binary signature
function detectImageFormat(bytes: Uint8Array): FormatInfo {
  if (!bytes || bytes.length < 4) {
    return { isGif: false, isAnimated: false, format: "UNKNOWN", mimeType: "application/octet-stream" };
  }

  // 1. GIF (GIF87a / GIF89a)
  const maxGifSearch = Math.min(512, bytes.length - 6);
  for (let i = 0; i <= maxGifSearch; i++) {
    if (
      bytes[i] === 0x47 &&     // G
      bytes[i + 1] === 0x49 && // I
      bytes[i + 2] === 0x46 && // F
      bytes[i + 3] === 0x38 && // 8
      (bytes[i + 4] === 0x37 || bytes[i + 4] === 0x39) && // 7 or 9
      bytes[i + 5] === 0x61    // a
    ) {
      let isAnimated = false;
      let frameMarkers = 0;
      const scanLimit = Math.min(bytes.length - 2, 65536);
      for (let j = i + 6; j < scanLimit; j++) {
        if (bytes[j] === 0x2C) {
          // Image Descriptor
          frameMarkers++;
          if (frameMarkers > 1) {
            isAnimated = true;
            break;
          }
        } else if (bytes[j] === 0x21 && bytes[j + 1] === 0xF9) {
          // Graphic Control Extension
          frameMarkers++;
          if (frameMarkers > 1) {
            isAnimated = true;
            break;
          }
        }
      }
      return {
        isGif: true,
        isAnimated: isAnimated || frameMarkers > 0,
        format: "GIF",
        mimeType: "image/gif"
      };
    }
  }

  // 2. WEBP (RIFF....WEBP)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50    // P
  ) {
    let isAnimated = false;

    // Check VP8X chunk (starts at offset 12)
    if (
      bytes.length >= 21 &&
      bytes[12] === 0x56 && // V
      bytes[13] === 0x50 && // P
      bytes[14] === 0x38 && // 8
      bytes[15] === 0x58    // X
    ) {
      // Byte 20 has flags: bit 1 (0x02) is Animation
      if ((bytes[20] & 0x02) !== 0) {
        isAnimated = true;
      }
    }

    // Search for ANIM (0x41, 0x4E, 0x49, 0x4D) or ANMF (0x41, 0x4E, 0x4D, 0x46)
    if (!isAnimated) {
      const searchLimit = Math.min(bytes.length - 4, 16384);
      for (let k = 12; k < searchLimit; k++) {
        if (
          bytes[k] === 0x41 &&
          bytes[k + 1] === 0x4E &&
          ((bytes[k + 2] === 0x49 && bytes[k + 3] === 0x4D) ||
           (bytes[k + 2] === 0x4D && bytes[k + 3] === 0x46))
        ) {
          isAnimated = true;
          break;
        }
      }
    }

    return {
      isGif: isAnimated,
      isAnimated,
      format: isAnimated ? "WEBP (Động)" : "WEBP",
      mimeType: "image/webp"
    };
  }

  // 3. PNG / APNG (Animated Portable Network Graphics)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 && // P
    bytes[2] === 0x4E && // N
    bytes[3] === 0x47 && // G
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A
  ) {
    let isAnimated = false;
    // Scan for acTL chunk (0x61, 0x63, 0x54, 0x4C)
    const searchLimit = Math.min(bytes.length - 4, 16384);
    for (let k = 8; k < searchLimit; k++) {
      if (
        bytes[k] === 0x61 &&     // a
        bytes[k + 1] === 0x63 && // c
        bytes[k + 2] === 0x54 && // T
        bytes[k + 3] === 0x4C    // L
      ) {
        isAnimated = true;
        break;
      }
    }

    return {
      isGif: isAnimated,
      isAnimated,
      format: isAnimated ? "APNG (Động)" : "PNG",
      mimeType: "image/png"
    };
  }

  // 4. MP4 / MOV Video
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70    // p
  ) {
    return { isGif: true, isAnimated: true, format: "MP4 (Video)", mimeType: "video/mp4" };
  }

  // 5. WebM Video (EBML Header: 0x1A 0x45 0xDF 0xA3)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1A &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xDF &&
    bytes[3] === 0xA3
  ) {
    return { isGif: true, isAnimated: true, format: "WebM (Video)", mimeType: "video/webm" };
  }

  // 6. JPEG
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF
  ) {
    return { isGif: false, isAnimated: false, format: "JPEG", mimeType: "image/jpeg" };
  }

  return { isGif: false, isAnimated: false, format: "MEDIA", mimeType: "application/octet-stream" };
}

// Helper to test if a node is an overall canvas / artboard rather than a single widget
function isArtboardOrCanvas(node: BaseNode | null): boolean {
  if (!node) return false;
  if (node.type === "PAGE" || node.type === "DOCUMENT" || node.type === "SECTION") return true;
  if ("width" in node && "height" in node) {
    const w = (node as any).width || 0;
    const h = (node as any).height || 0;
    // Standard screens/artboards are 1000px+ (Desktop 1440, iPad 1024, etc.)
    if (w >= 1000 || h >= 1000) return true;
  }
  return false;
}

// Find closest Widget Frame (traverse past inner AutoLayouts up to Frame under Section or Page)
function findWidgetContainer(node: SceneNode, rootSelection?: readonly SceneNode[]): FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode {
  const ancestors: (FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode)[] = [];
  let curr: BaseNode | null = node;

  while (curr && curr.type !== "PAGE" && curr.type !== "DOCUMENT") {
    if (
      curr.type === "FRAME" ||
      curr.type === "COMPONENT" ||
      curr.type === "INSTANCE" ||
      curr.type === "GROUP"
    ) {
      ancestors.push(curr as any);
    }
    curr = curr.parent;
  }

  if (ancestors.length === 0) {
    return node as any;
  }

  // 1. If any ancestor is in rootSelection (and not Section or large Artboard), return it
  if (rootSelection && rootSelection.length > 0) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i];
      if (rootSelection.some((sel) => sel.id === a.id && sel.type !== "SECTION")) {
        if (!isArtboardOrCanvas(a)) {
          return a;
        }
      }
    }
  }

  // 2. Direct child of Section or Page (top-level widget container)
  for (let i = 0; i < ancestors.length; i++) {
    const a = ancestors[i];
    if (a.parent && (a.parent.type === "SECTION" || a.parent.type === "PAGE")) {
      return a;
    }
  }

  // 3. Direct child of a large Artboard/Screen (e.g. Desktop 1440x1024)
  for (let i = 0; i < ancestors.length; i++) {
    const a = ancestors[i];
    if (a.parent && isArtboardOrCanvas(a.parent)) {
      return a;
    }
  }

  // 4. Outermost card below artboard/canvas
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (!isArtboardOrCanvas(a)) {
      return a;
    }
  }

  return ancestors[ancestors.length - 1];
}

// Find the closest visual boundary node for a sticker (e.g. InstanceNode or Frame with clipsContent: true)
function getVisualStickerNode(node: SceneNode, container: SceneNode): SceneNode {
  let curr: BaseNode | null = node;
  let visualNode: SceneNode = node;

  while (curr && curr !== container) {
    if (curr.type === "FRAME" || curr.type === "INSTANCE" || curr.type === "COMPONENT") {
      const sNode = curr as SceneNode;
      // If sNode is an InstanceNode or a Frame with clipsContent, this is the visual sticker container!
      if (sNode.type === "INSTANCE" || ("clipsContent" in sNode && (sNode as FrameNode).clipsContent)) {
        visualNode = sNode;
        break; // Stop at closest (innermost) clipping boundary / component instance!
      }
    }
    curr = curr.parent;
  }
  return visualNode;
}

interface TargetItem {
  node: SceneNode;
  container: FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode;
  hash: string;
  fillType: "IMAGE" | "VIDEO";
  scaleMode?: string;
}

// Collect all media fills (IMAGE and VIDEO) across fills, backgrounds, strokes
function collectAllMediaFills(nodes: readonly SceneNode[], rootSelection?: readonly SceneNode[]): TargetItem[] {
  const results: TargetItem[] = [];
  const seen = new Set<string>();

  function addTarget(node: SceneNode, hash: string, fillType: "IMAGE" | "VIDEO", scaleMode?: string) {
    const key = `${node.id}:${hash}`;
    if (!seen.has(key)) {
      seen.add(key);
      const container = findWidgetContainer(node, rootSelection);
      results.push({
        node,
        container,
        hash,
        fillType,
        scaleMode: scaleMode || "FILL"
      });
    }
  }

  function inspect(node: SceneNode) {
    // 1. Inspect fills
    if ("fills" in node) {
      const fills = (node as any).fills;
      if (Array.isArray(fills)) {
        for (const fill of fills) {
          if (!fill || fill.visible === false) continue;
          if (fill.type === "IMAGE" && fill.imageHash) {
            addTarget(node, fill.imageHash, "IMAGE", fill.scaleMode);
          } else if (fill.type === "VIDEO" && fill.videoHash) {
            addTarget(node, fill.videoHash, "VIDEO", fill.scaleMode);
          }
        }
      }
    }

    // 2. Inspect backgrounds (in FrameNode)
    if ("backgrounds" in node) {
      const bgs = (node as any).backgrounds;
      if (Array.isArray(bgs)) {
        for (const bg of bgs) {
          if (!bg || bg.visible === false) continue;
          if (bg.type === "IMAGE" && bg.imageHash) {
            addTarget(node, bg.imageHash, "IMAGE", bg.scaleMode);
          } else if (bg.type === "VIDEO" && bg.videoHash) {
            addTarget(node, bg.videoHash, "VIDEO", bg.scaleMode);
          }
        }
      }
    }

    // 3. Inspect strokes
    if ("strokes" in node) {
      const strokes = (node as any).strokes;
      if (Array.isArray(strokes)) {
        for (const stroke of strokes) {
          if (!stroke || stroke.visible === false) continue;
          if (stroke.type === "IMAGE" && stroke.imageHash) {
            addTarget(node, stroke.imageHash, "IMAGE", stroke.scaleMode);
          }
        }
      }
    }

    // 4. Children recursion (Frames, Instances, Components, Groups, Sections, etc.)
    if ("children" in node && Array.isArray((node as any).children)) {
      for (const child of (node as any).children) {
        inspect(child);
      }
    }
  }

  for (const root of nodes) {
    inspect(root);
  }

  return results;
}

// Send selection status to UI
function notifySelectionStatus() {
  const selection = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "SELECTION_STATUS",
    count: selection.length,
    names: selection.map((n) => n.name)
  });
}

figma.on("selectionchange", () => {
  notifySelectionStatus();
});

export interface AnimatedLayerInfo {
  nodeId: string;
  visualNodeId: string;
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

// Accurately determine true visual dimensions, corner radius, and widget type (capsule vs standard widget)
function findWidgetProperties(container: FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode) {
  let visualWidth = Math.max(1, Math.round(container.width));
  let visualHeight = Math.max(1, Math.round(container.height));
  let detectedRadius = 0;

  // 1. Direct container corner radius (Frame, Component, Instance)
  if (typeof (container as any).cornerRadius === "number" && (container as any).cornerRadius > 0) {
    detectedRadius = (container as any).cornerRadius;
  } else if (typeof (container as any).topLeftRadius === "number" && (container as any).topLeftRadius > 0) {
    detectedRadius = Math.max(
      (container as any).topLeftRadius || 0,
      (container as any).topRightRadius || 0,
      (container as any).bottomLeftRadius || 0,
      (container as any).bottomRightRadius || 0
    );
  }

  // 2. Check direct children for background shape (e.g. background Rectangle) and visual height/width
  if ("children" in container && Array.isArray((container as any).children)) {
    for (const child of (container as any).children) {
      if (child.visible === false) continue;
      const cX = Math.round(child.x || 0);
      const cY = Math.round(child.y || 0);
      const cW = Math.round(child.width || 0);
      const cH = Math.round(child.height || 0);
      const childRight = cX + cW;
      const childBottom = cY + cH;

      // Child covers container horizontally and starts near top (background card shape)
      const wDiff = Math.abs(cW - container.width);
      if (wDiff <= 8 && cX <= 5 && cY <= 5) {
        if (childBottom > visualHeight) {
          visualHeight = childBottom;
        }
        if (childRight > visualWidth) {
          visualWidth = childRight;
        }

        if (detectedRadius === 0) {
          if (typeof child.cornerRadius === "number" && child.cornerRadius > 0) {
            detectedRadius = Math.max(detectedRadius, child.cornerRadius);
          } else if (typeof child.topLeftRadius === "number" && child.topLeftRadius > 0) {
            detectedRadius = Math.max(
              detectedRadius,
              child.topLeftRadius || 0,
              child.topRightRadius || 0,
              child.bottomLeftRadius || 0,
              child.bottomRightRadius || 0
            );
          }
        }
      }
    }
  }

  const halfH = Math.floor(visualHeight / 2);
  const halfW = Math.floor(visualWidth / 2);
  const maxPossibleRadius = Math.min(halfH, halfW);
  detectedRadius = Math.min(detectedRadius, maxPossibleRadius);

  // 3. Dynamic Island / pill capsule check:
  // True capsule if:
  // - Name explicitly matches /island|pill|capsule/i OR
  // - Has radius near half height (stadium shape)
  const isCapsule = /island|pill|capsule/i.test(container.name) ||
                    (visualWidth >= visualHeight * 1.8 && detectedRadius >= halfH - 4);

  let finalRadius = 0;
  if (isCapsule) {
    finalRadius = halfH;
  } else if (detectedRadius > 0) {
    finalRadius = detectedRadius;
  } else {
    // Sharp rectangle corner (góc nhọn / vuông) -> STRICTLY 0! No artificial rounding!
    finalRadius = 0;
  }

  return {
    visualWidth,
    visualHeight,
    cornerRadius: finalRadius,
    isCapsule
  };
}

// Handle UI Messages
figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "INIT") {
      notifySelectionStatus();
    } else if (msg.type === "SCAN_IMAGES") {
      let scope: "selection" | "page" = msg.scope || "selection";
      const scale: number = Number(msg.scale) || 1;

      let sourceNodes: readonly SceneNode[] = [];

      if (scope === "selection") {
        sourceNodes = figma.currentPage.selection;
        // If nothing is selected, automatically fallback to scanning whole page!
        if (sourceNodes.length === 0) {
          sourceNodes = figma.currentPage.children;
          scope = "page";
        }
      } else {
        sourceNodes = figma.currentPage.children;
      }

      // Collect all media fills (IMAGE and VIDEO)
      const targets = collectAllMediaFills(sourceNodes, scope === "selection" ? sourceNodes : undefined);
      const items = [];
      const debugLogs = [];

      debugLogs.push(`Phạm vi: ${scope === "selection" ? "Vùng chọn" : "Toàn bộ trang"} (${sourceNodes.length} node gốc).`);
      debugLogs.push(`Tìm thấy ${targets.length} layer media.`);

      // Group targets by container so multi-sticker widgets are exported together!
      const containerMap = new Map<string, {
        container: FrameNode | ComponentNode | InstanceNode | GroupNode | SectionNode;
        targets: TargetItem[];
      }>();

      for (const target of targets) {
        const cId = target.container.id;
        let entry = containerMap.get(cId);
        if (!entry) {
          entry = { container: target.container, targets: [] };
          containerMap.set(cId, entry);
        }
        entry.targets.push(target);
      }

      let containerIdx = 0;
      const totalContainers = containerMap.size;

      for (const [containerId, { container, targets: cTargets }] of containerMap.entries()) {
        containerIdx++;
        figma.ui.postMessage({
          type: "SCAN_PROGRESS",
          current: containerIdx,
          total: totalContainers,
          frameName: container.name,
          layerName: `${cTargets.length} layers`
        });

        const layers: AnimatedLayerInfo[] = [];

        for (const target of cTargets) {
          try {
            let bytes: Uint8Array | null = null;
            if (target.hash) {
              try {
                const image = figma.getImageByHash(target.hash);
                if (image) {
                  bytes = await image.getBytesAsync();
                }
              } catch (e) {
                console.warn("getImageByHash failed:", e);
              }
            }

            if (!bytes || bytes.length === 0) {
              try {
                bytes = await target.node.exportAsync({ format: "PNG" });
              } catch (e2) {
                console.error("exportAsync failed for node:", target.node.name, e2);
              }
            }

            if (!bytes || bytes.length === 0) {
              debugLogs.push(`❌ Node "${target.node.name}": không lấy được byte.`);
              continue;
            }

            let formatInfo = detectImageFormat(bytes);
            if (target.fillType === "VIDEO") {
              formatInfo = {
                isGif: true,
                isAnimated: true,
                format: "VIDEO (Động)",
                mimeType: "video/mp4"
              };
            }

            const nameHint = (target.node.name + " " + container.name).toLowerCase();
            if (nameHint.includes(".gif") || nameHint.includes("gif") || nameHint.includes("anim")) {
              if (!formatInfo.isAnimated) {
                formatInfo.isGif = true;
                formatInfo.isAnimated = true;
                formatInfo.format = "GIF (Theo tên)";
                formatInfo.mimeType = "image/gif";
              }
            }

            // Determine true visual sticker node (e.g. InstanceNode or Frame with clipsContent: true)
            const visualNode = getVisualStickerNode(target.node, container);

            // Accurate 1x Figma coordinates using page-space absolute bounding boxes
            let relX = 0;
            let relY = 0;
            let relWidth = Math.max(1, Math.round(visualNode.width));
            let relHeight = Math.max(1, Math.round(visualNode.height));
            let stickerRadius = 0;

            if (typeof (visualNode as any).cornerRadius === "number" && (visualNode as any).cornerRadius > 0) {
              stickerRadius = (visualNode as any).cornerRadius;
            }

            if (visualNode.absoluteBoundingBox && container.absoluteBoundingBox) {
              relX = Math.round(visualNode.absoluteBoundingBox.x - container.absoluteBoundingBox.x);
              relY = Math.round(visualNode.absoluteBoundingBox.y - container.absoluteBoundingBox.y);
              relWidth = Math.max(1, Math.round(visualNode.absoluteBoundingBox.width));
              relHeight = Math.max(1, Math.round(visualNode.absoluteBoundingBox.height));
            } else if (target.node.absoluteBoundingBox && container.absoluteBoundingBox) {
              relX = Math.round(target.node.absoluteBoundingBox.x - container.absoluteBoundingBox.x);
              relY = Math.round(target.node.absoluteBoundingBox.y - container.absoluteBoundingBox.y);
              relWidth = Math.max(1, Math.round(target.node.absoluteBoundingBox.width));
              relHeight = Math.max(1, Math.round(target.node.absoluteBoundingBox.height));
            } else {
              try {
                const cX = visualNode.absoluteTransform[0][2];
                const cY = visualNode.absoluteTransform[1][2];
                const pX = container.absoluteTransform[0][2];
                const pY = container.absoluteTransform[1][2];
                relX = Math.round(cX - pX);
                relY = Math.round(cY - pY);
              } catch (err) {}
            }

            layers.push({
              nodeId: target.node.id,
              visualNodeId: visualNode.id,
              nodeName: visualNode.name || target.node.name,
              bytes,
              relX,
              relY,
              relWidth,
              relHeight,
              cornerRadius: stickerRadius,
              format: formatInfo.format,
              mimeType: formatInfo.mimeType,
              isAnimated: formatInfo.isAnimated,
              scaleMode: target.scaleMode || "FILL"
            });

            debugLogs.push(
              `✔ Frame "${container.name}" > Layer "${target.node.name}": ${formatInfo.format} (${bytes.length} B, động: ${formatInfo.isAnimated})`
            );
          } catch (err: any) {
            console.error("Error processing target:", target.node.name, err);
            debugLogs.push(`❌ Lỗi tại "${target.node.name}": ${err?.message || err}`);
          }
        }

        if (layers.length === 0) continue;

        const animLayers = layers.filter((l) => l.isAnimated);
        const primaryLayers = animLayers.length > 0 ? animLayers : layers;
        const primary = primaryLayers[0];

        // 1x Native unscaled dimensions (taking into account true visual bounds)
        const { visualWidth, visualHeight, cornerRadius, isCapsule } = findWidgetProperties(container);
        const frameWidth = visualWidth;
        const frameHeight = visualHeight;
        const clipsContent = "clipsContent" in container ? (container as any).clipsContent : false;

        const combinedNames = animLayers.length > 1
          ? animLayers.map((l) => l.nodeName).join(", ")
          : primary.nodeName;

        items.push({
          id: `${container.id}_composite`,
          frameId: container.id,
          frameName: container.name,
          frameWidth,
          frameHeight,
          cornerRadius,
          isCapsule,
          clipsContent,
          scale: 1, // Base 1x scale
          animatedLayers: animLayers.length > 0 ? animLayers : [primary],
          gifNodeId: primary.nodeId,
          gifVisualNodeId: primary.visualNodeId,
          gifNodeName: combinedNames,
          gifBytes: primary.bytes,
          relX: primary.relX,
          relY: primary.relY,
          relWidth: primary.relWidth,
          relHeight: primary.relHeight,
          stickerCornerRadius: primary.cornerRadius,
          scaleMode: primary.scaleMode || "FILL",
          format: animLayers.length > 1 ? `GIF (${animLayers.length} động)` : primary.format,
          mimeType: primary.mimeType,
          isGif: animLayers.length > 0,
          isAnimated: animLayers.length > 0
        });
      }

      // Send results immediately to UI
      figma.ui.postMessage({
        type: "SCAN_RESULTS",
        scope,
        items,
        debugLogs,
        scannedTargetsCount: targets.length
      });
    } else if (msg.type === "GET_BASE_PNG") {
      // On-demand export of a single container frame as clean PNG with all animated stickers hidden
      const requestId = msg.requestId;
      const frameId = msg.frameId;
      const gifNodeIds: string[] = Array.isArray(msg.gifNodeIds)
        ? msg.gifNodeIds
        : (msg.gifNodeId ? [msg.gifNodeId] : []);
      const scale = Number(msg.scale) || 1;

      let basePngBytes = new Uint8Array(0);

      try {
        const container = figma.getNodeById(frameId) as any;

        if (container && "exportAsync" in container) {
          // CRITICAL: Hide animated sticker nodes using opacity = 0 ONLY!
          // NEVER set visible = false, because visible = false causes Auto Layout in Figma to collapse,
          // shifting sibling elements (text, icons) and mangling the design layout!
          const hiddenNodes: { node: any; origOpacity: number }[] = [];
          for (const nid of gifNodeIds) {
            if (!nid || nid === container.id) continue;
            const node = figma.getNodeById(nid);
            if (node && "opacity" in node) {
              try {
                hiddenNodes.push({
                  node,
                  origOpacity: (node as any).opacity
                });
                (node as any).opacity = 0;
              } catch (e) {}
            }
          }

          let origClipsContent: boolean | undefined = undefined;
          if ("clipsContent" in container) {
            origClipsContent = container.clipsContent;
            try {
              container.clipsContent = true;
            } catch (e) {}
          }

          try {
            basePngBytes = await container.exportAsync({
              format: "PNG",
              constraint: { type: "SCALE", value: scale }
            });
          } catch (e) {
            console.warn("Base PNG export failed with opacity 0, retrying direct:", e);
            basePngBytes = await container.exportAsync({
              format: "PNG",
              constraint: { type: "SCALE", value: scale }
            });
          } finally {
            if (origClipsContent !== undefined && "clipsContent" in container) {
              try {
                container.clipsContent = origClipsContent;
              } catch (e) {}
            }
            for (const h of hiddenNodes) {
              try {
                h.node.opacity = h.origOpacity;
              } catch (e) {}
            }
          }
        }
      } catch (err: any) {
        console.error("GET_BASE_PNG failed:", err);
      }

      figma.ui.postMessage({
        type: "BASE_PNG_RESULT",
        requestId,
        frameId,
        basePngBytes
      });
    } else if (msg.type === "FOCUS_NODE") {
      const node = figma.getNodeById(msg.nodeId);
      if (node && "type" in node) {
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        figma.notify(`Đã chuyển tới: ${node.name}`);
      } else {
        figma.notify("Layer không còn tồn tại trên trang này", { error: true });
      }
    } else if (msg.type === "FETCH_FRAMES_FOR_GIF") {
      const selection = figma.currentPage.selection;
      if (selection.length < 2) {
        figma.ui.postMessage({
          type: "FRAMES_EXPORT_ERROR",
          message: "Hãy chọn ít nhất 2 frame trên Canvas để ghép thành GIF."
        });
        return;
      }

      const scale = Number(msg.scale) || 1;
      const frames = [];

      for (let i = 0; i < selection.length; i++) {
        const node = selection[i];
        try {
          const bytes = await node.exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: scale }
          });

          frames.push({
            id: node.id,
            name: node.name,
            index: i + 1,
            width: Math.round(node.width * scale),
            height: Math.round(node.height * scale),
            bytes: bytes
          });
        } catch (err) {
          console.error(`Error exporting frame ${node.name}:`, err);
        }
      }

      figma.ui.postMessage({
        type: "FRAMES_EXPORT_SUCCESS",
        frames
      });
    } else if (msg.type === "NOTIFY") {
      figma.notify(msg.message, { error: !!msg.isError });
    } else if (msg.type === "RESIZE_WINDOW") {
      figma.ui.resize(msg.width, msg.height);
    }
  } catch (error: any) {
    console.error("Plugin internal error:", error);
    figma.ui.postMessage({
      type: "ERROR",
      message: error?.message || "Đã xảy ra lỗi không xác định."
    });
  }
};
