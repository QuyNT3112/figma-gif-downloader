"use strict";
(() => {
  // src/code.ts
  figma.showUI(__html__, {
    width: 500,
    height: 690,
    themeColors: true,
    title: "GIF Downloader & Frame Exporter PRO"
  });
  function detectImageFormat(bytes) {
    if (!bytes || bytes.length < 4) {
      return { isGif: false, isAnimated: false, format: "UNKNOWN", mimeType: "application/octet-stream" };
    }
    const maxGifSearch = Math.min(512, bytes.length - 6);
    for (let i = 0; i <= maxGifSearch; i++) {
      if (bytes[i] === 71 && // G
      bytes[i + 1] === 73 && // I
      bytes[i + 2] === 70 && // F
      bytes[i + 3] === 56 && // 8
      (bytes[i + 4] === 55 || bytes[i + 4] === 57) && // 7 or 9
      bytes[i + 5] === 97) {
        let isAnimated = false;
        let frameMarkers = 0;
        const scanLimit = Math.min(bytes.length - 2, 65536);
        for (let j = i + 6; j < scanLimit; j++) {
          if (bytes[j] === 44) {
            frameMarkers++;
            if (frameMarkers > 1) {
              isAnimated = true;
              break;
            }
          } else if (bytes[j] === 33 && bytes[j + 1] === 249) {
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
    if (bytes.length >= 12 && bytes[0] === 82 && // R
    bytes[1] === 73 && // I
    bytes[2] === 70 && // F
    bytes[3] === 70 && // F
    bytes[8] === 87 && // W
    bytes[9] === 69 && // E
    bytes[10] === 66 && // B
    bytes[11] === 80) {
      let isAnimated = false;
      if (bytes.length >= 21 && bytes[12] === 86 && // V
      bytes[13] === 80 && // P
      bytes[14] === 56 && // 8
      bytes[15] === 88) {
        if ((bytes[20] & 2) !== 0) {
          isAnimated = true;
        }
      }
      if (!isAnimated) {
        const searchLimit = Math.min(bytes.length - 4, 16384);
        for (let k = 12; k < searchLimit; k++) {
          if (bytes[k] === 65 && bytes[k + 1] === 78 && (bytes[k + 2] === 73 && bytes[k + 3] === 77 || bytes[k + 2] === 77 && bytes[k + 3] === 70)) {
            isAnimated = true;
            break;
          }
        }
      }
      return {
        isGif: isAnimated,
        isAnimated,
        format: isAnimated ? "WEBP (\u0110\u1ED9ng)" : "WEBP",
        mimeType: "image/webp"
      };
    }
    if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && // P
    bytes[2] === 78 && // N
    bytes[3] === 71 && // G
    bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
      let isAnimated = false;
      const searchLimit = Math.min(bytes.length - 4, 16384);
      for (let k = 8; k < searchLimit; k++) {
        if (bytes[k] === 97 && // a
        bytes[k + 1] === 99 && // c
        bytes[k + 2] === 84 && // T
        bytes[k + 3] === 76) {
          isAnimated = true;
          break;
        }
      }
      return {
        isGif: isAnimated,
        isAnimated,
        format: isAnimated ? "APNG (\u0110\u1ED9ng)" : "PNG",
        mimeType: "image/png"
      };
    }
    if (bytes.length >= 8 && bytes[4] === 102 && // f
    bytes[5] === 116 && // t
    bytes[6] === 121 && // y
    bytes[7] === 112) {
      return { isGif: true, isAnimated: true, format: "MP4 (Video)", mimeType: "video/mp4" };
    }
    if (bytes.length >= 4 && bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163) {
      return { isGif: true, isAnimated: true, format: "WebM (Video)", mimeType: "video/webm" };
    }
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      return { isGif: false, isAnimated: false, format: "JPEG", mimeType: "image/jpeg" };
    }
    return { isGif: false, isAnimated: false, format: "MEDIA", mimeType: "application/octet-stream" };
  }
  function isArtboardOrCanvas(node) {
    if (!node) return false;
    if (node.type === "PAGE" || node.type === "DOCUMENT" || node.type === "SECTION") return true;
    if ("width" in node && "height" in node) {
      const w = node.width || 0;
      const h = node.height || 0;
      if (w >= 1e3 || h >= 1e3) return true;
    }
    return false;
  }
  function findWidgetContainer(node, rootSelection) {
    const ancestors = [];
    let curr = node;
    while (curr && curr.type !== "PAGE" && curr.type !== "DOCUMENT") {
      if (curr.type === "FRAME" || curr.type === "COMPONENT" || curr.type === "INSTANCE" || curr.type === "GROUP") {
        ancestors.push(curr);
      }
      curr = curr.parent;
    }
    if (ancestors.length === 0) {
      return node;
    }
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
    for (let i = 0; i < ancestors.length; i++) {
      const a = ancestors[i];
      if (a.parent && (a.parent.type === "SECTION" || a.parent.type === "PAGE")) {
        return a;
      }
    }
    for (let i = 0; i < ancestors.length; i++) {
      const a = ancestors[i];
      if (a.parent && isArtboardOrCanvas(a.parent)) {
        return a;
      }
    }
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i];
      if (!isArtboardOrCanvas(a)) {
        return a;
      }
    }
    return ancestors[ancestors.length - 1];
  }
  function getVisualStickerNode(node, container) {
    let curr = node;
    let visualNode = node;
    while (curr && curr !== container) {
      if (curr.type === "FRAME" || curr.type === "INSTANCE" || curr.type === "COMPONENT") {
        const sNode = curr;
        if (sNode.type === "INSTANCE" || "clipsContent" in sNode && sNode.clipsContent) {
          visualNode = sNode;
          break;
        }
      }
      curr = curr.parent;
    }
    return visualNode;
  }
  function collectAllMediaFills(nodes, rootSelection) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    function addTarget(node, hash, fillType, scaleMode) {
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
    function inspect(node) {
      if ("fills" in node) {
        const fills = node.fills;
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
      if ("backgrounds" in node) {
        const bgs = node.backgrounds;
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
      if ("strokes" in node) {
        const strokes = node.strokes;
        if (Array.isArray(strokes)) {
          for (const stroke of strokes) {
            if (!stroke || stroke.visible === false) continue;
            if (stroke.type === "IMAGE" && stroke.imageHash) {
              addTarget(node, stroke.imageHash, "IMAGE", stroke.scaleMode);
            }
          }
        }
      }
      if ("children" in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          inspect(child);
        }
      }
    }
    for (const root of nodes) {
      inspect(root);
    }
    return results;
  }
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
  function findWidgetProperties(container) {
    let visualWidth = Math.max(1, Math.round(container.width));
    let visualHeight = Math.max(1, Math.round(container.height));
    let detectedRadius = 0;
    if (typeof container.cornerRadius === "number" && container.cornerRadius > 0) {
      detectedRadius = container.cornerRadius;
    } else if (typeof container.topLeftRadius === "number" && container.topLeftRadius > 0) {
      detectedRadius = Math.max(
        container.topLeftRadius || 0,
        container.topRightRadius || 0,
        container.bottomLeftRadius || 0,
        container.bottomRightRadius || 0
      );
    }
    if ("children" in container && Array.isArray(container.children)) {
      for (const child of container.children) {
        if (child.visible === false) continue;
        const cX = Math.round(child.x || 0);
        const cY = Math.round(child.y || 0);
        const cW = Math.round(child.width || 0);
        const cH = Math.round(child.height || 0);
        const childRight = cX + cW;
        const childBottom = cY + cH;
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
    const isCapsule = /island|pill|capsule/i.test(container.name) || visualWidth >= visualHeight * 1.8 && detectedRadius >= halfH - 4;
    let finalRadius = 0;
    if (isCapsule) {
      finalRadius = halfH;
    } else if (detectedRadius > 0) {
      finalRadius = detectedRadius;
    } else {
      finalRadius = 0;
    }
    return {
      visualWidth,
      visualHeight,
      cornerRadius: finalRadius,
      isCapsule
    };
  }
  figma.ui.onmessage = async (msg) => {
    try {
      if (msg.type === "INIT") {
        notifySelectionStatus();
      } else if (msg.type === "SCAN_IMAGES") {
        let scope = msg.scope || "selection";
        const scale = Number(msg.scale) || 1;
        let sourceNodes = [];
        if (scope === "selection") {
          sourceNodes = figma.currentPage.selection;
          if (sourceNodes.length === 0) {
            sourceNodes = figma.currentPage.children;
            scope = "page";
          }
        } else {
          sourceNodes = figma.currentPage.children;
        }
        const targets = collectAllMediaFills(sourceNodes, scope === "selection" ? sourceNodes : void 0);
        const items = [];
        const debugLogs = [];
        debugLogs.push(`Ph\u1EA1m vi: ${scope === "selection" ? "V\xF9ng ch\u1ECDn" : "To\xE0n b\u1ED9 trang"} (${sourceNodes.length} node g\u1ED1c).`);
        debugLogs.push(`T\xECm th\u1EA5y ${targets.length} layer media.`);
        const containerMap = /* @__PURE__ */ new Map();
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
          const layers = [];
          for (const target of cTargets) {
            try {
              let bytes = null;
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
                debugLogs.push(`\u274C Node "${target.node.name}": kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c byte.`);
                continue;
              }
              let formatInfo = detectImageFormat(bytes);
              if (target.fillType === "VIDEO") {
                formatInfo = {
                  isGif: true,
                  isAnimated: true,
                  format: "VIDEO (\u0110\u1ED9ng)",
                  mimeType: "video/mp4"
                };
              }
              const nameHint = (target.node.name + " " + container.name).toLowerCase();
              if (nameHint.includes(".gif") || nameHint.includes("gif") || nameHint.includes("anim")) {
                if (!formatInfo.isAnimated) {
                  formatInfo.isGif = true;
                  formatInfo.isAnimated = true;
                  formatInfo.format = "GIF (Theo t\xEAn)";
                  formatInfo.mimeType = "image/gif";
                }
              }
              const visualNode = getVisualStickerNode(target.node, container);
              let relX = 0;
              let relY = 0;
              let relWidth = Math.max(1, Math.round(visualNode.width));
              let relHeight = Math.max(1, Math.round(visualNode.height));
              let stickerRadius = 0;
              if (typeof visualNode.cornerRadius === "number" && visualNode.cornerRadius > 0) {
                stickerRadius = visualNode.cornerRadius;
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
                } catch (err) {
                }
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
                `\u2714 Frame "${container.name}" > Layer "${target.node.name}": ${formatInfo.format} (${bytes.length} B, \u0111\u1ED9ng: ${formatInfo.isAnimated})`
              );
            } catch (err) {
              console.error("Error processing target:", target.node.name, err);
              debugLogs.push(`\u274C L\u1ED7i t\u1EA1i "${target.node.name}": ${err?.message || err}`);
            }
          }
          if (layers.length === 0) continue;
          const animLayers = layers.filter((l) => l.isAnimated);
          const primaryLayers = animLayers.length > 0 ? animLayers : layers;
          const primary = primaryLayers[0];
          const { visualWidth, visualHeight, cornerRadius, isCapsule } = findWidgetProperties(container);
          const frameWidth = visualWidth;
          const frameHeight = visualHeight;
          const clipsContent = "clipsContent" in container ? container.clipsContent : false;
          const combinedNames = animLayers.length > 1 ? animLayers.map((l) => l.nodeName).join(", ") : primary.nodeName;
          items.push({
            id: `${container.id}_composite`,
            frameId: container.id,
            frameName: container.name,
            frameWidth,
            frameHeight,
            cornerRadius,
            isCapsule,
            clipsContent,
            scale: 1,
            // Base 1x scale
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
            format: animLayers.length > 1 ? `GIF (${animLayers.length} \u0111\u1ED9ng)` : primary.format,
            mimeType: primary.mimeType,
            isGif: animLayers.length > 0,
            isAnimated: animLayers.length > 0
          });
        }
        figma.ui.postMessage({
          type: "SCAN_RESULTS",
          scope,
          items,
          debugLogs,
          scannedTargetsCount: targets.length
        });
      } else if (msg.type === "GET_BASE_PNG") {
        const requestId = msg.requestId;
        const frameId = msg.frameId;
        const gifNodeIds = Array.isArray(msg.gifNodeIds) ? msg.gifNodeIds : msg.gifNodeId ? [msg.gifNodeId] : [];
        const scale = Number(msg.scale) || 1;
        let basePngBytes = new Uint8Array(0);
        try {
          const container = figma.getNodeById(frameId);
          if (container && "exportAsync" in container) {
            const hiddenNodes = [];
            for (const nid of gifNodeIds) {
              if (!nid || nid === container.id) continue;
              const node = figma.getNodeById(nid);
              if (node && "opacity" in node) {
                try {
                  hiddenNodes.push({
                    node,
                    origOpacity: node.opacity
                  });
                  node.opacity = 0;
                } catch (e) {
                }
              }
            }
            let origClipsContent = void 0;
            if ("clipsContent" in container) {
              origClipsContent = container.clipsContent;
              try {
                container.clipsContent = true;
              } catch (e) {
              }
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
              if (origClipsContent !== void 0 && "clipsContent" in container) {
                try {
                  container.clipsContent = origClipsContent;
                } catch (e) {
                }
              }
              for (const h of hiddenNodes) {
                try {
                  h.node.opacity = h.origOpacity;
                } catch (e) {
                }
              }
            }
          }
        } catch (err) {
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
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          figma.notify(`\u0110\xE3 chuy\u1EC3n t\u1EDBi: ${node.name}`);
        } else {
          figma.notify("Layer kh\xF4ng c\xF2n t\u1ED3n t\u1EA1i tr\xEAn trang n\xE0y", { error: true });
        }
      } else if (msg.type === "FETCH_FRAMES_FOR_GIF") {
        const selection = figma.currentPage.selection;
        if (selection.length < 2) {
          figma.ui.postMessage({
            type: "FRAMES_EXPORT_ERROR",
            message: "H\xE3y ch\u1ECDn \xEDt nh\u1EA5t 2 frame tr\xEAn Canvas \u0111\u1EC3 gh\xE9p th\xE0nh GIF."
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
              bytes
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
    } catch (error) {
      console.error("Plugin internal error:", error);
      figma.ui.postMessage({
        type: "ERROR",
        message: error?.message || "\u0110\xE3 x\u1EA3y ra l\u1ED7i kh\xF4ng x\xE1c \u0111\u1ECBnh."
      });
    }
  };
})();
