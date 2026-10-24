import {
  controllerMenuLabel,
  controllerText,
  getControllerType,
  type ControllerType,
} from "./gamepadInput.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, String(value));
  return node;
}

export function createControllerIcon(
  label: string,
  direction?: readonly [number, number],
) {
  const svg = svgNode("svg", {
    viewBox: "0 0 48 48",
    "aria-hidden": "true",
    focusable: "false",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2.4,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.classList.add("controller-input-icon");
  const stick = /stick/i.test(label),
    dpad = /d-pad/i.test(label);
  if (stick || dpad) {
    svg.append(
      stick
        ? svgNode("circle", { cx: 24, cy: 24, r: 17 })
        : svgNode("path", {
            d: "M17 6h14v11h11v14H31v11H17V31H6V17h11z",
          }),
    );
    const name = /(?:stick|d-pad)\s+(up|down|left|right)$/i
      .exec(label)?.[1]
      .toLowerCase();
    const [x, y] = direction ?? [
      name === "left" ? -1 : name === "right" ? 1 : 0,
      name === "up" ? -1 : name === "down" ? 1 : 0,
    ];
    if (x || y) {
      const rotation = x === 1 ? 90 : x === -1 ? -90 : y === 1 ? 180 : 0;
      svg.append(
        svgNode("path", {
          d: "M24 3l-5 8h10z",
          fill: "currentColor",
          stroke: "none",
          transform: `rotate(${rotation} 24 24)`,
        }),
      );
    }
    if (stick) {
      svg.append(
        svgNode("circle", {
          cx: 24 + x * 8,
          cy: 24 + y * 8,
          r: 8,
          fill: "currentColor",
        }),
      );
      const side = /^left/i.test(label)
        ? "L"
        : /^right/i.test(label)
          ? "R"
          : "";
      if (side) {
        const text = svgNode("text", {
          x: 24,
          y: 45,
          "text-anchor": "middle",
          "font-size": 9,
          "font-weight": 800,
          fill: "currentColor",
          stroke: "none",
        });
        text.textContent = side;
        svg.append(text);
      }
    }
    return svg;
  }
  const shoulder = /^(?:Z?[LR]|[LR][12BT])$|shoulder|trigger/i.test(label);
  svg.append(
    shoulder
      ? svgNode("rect", { x: 3, y: 10, width: 42, height: 29, rx: 7 })
      : svgNode("circle", { cx: 24, cy: 24, r: 19 }),
  );
  if (/^cross$/i.test(label))
    svg.append(svgNode("path", { d: "M16 16l16 16m0-16L16 32" }));
  else if (/^circle$/i.test(label))
    svg.append(svgNode("circle", { cx: 24, cy: 24, r: 11 }));
  else if (/^square$/i.test(label))
    svg.append(svgNode("rect", { x: 14, y: 14, width: 20, height: 20 }));
  else if (/^triangle$/i.test(label))
    svg.append(svgNode("path", { d: "M24 12l13 23H11z" }));
  else if (label === "+")
    svg.append(svgNode("path", { d: "M24 14v20m-10-10h20" }));
  else if (label === "-") svg.append(svgNode("path", { d: "M14 24h20" }));
  else if (/^(menu|options)$/i.test(label))
    svg.append(svgNode("path", { d: "M14 17h20m-20 7h20m-20 7h20" }));
  else {
    const caption =
      /^Button (\d+)/i.exec(label)?.[1] ??
      (/create|share/i.test(label) ? "SHARE" : label);
    const text = svgNode("text", {
      x: 24,
      y: 25,
      "dominant-baseline": "middle",
      "text-anchor": "middle",
      "font-size": caption.length > 3 ? 8 : caption.length > 1 ? 12 : 20,
      "font-weight": 800,
      "font-family": "system-ui, sans-serif",
      fill: "currentColor",
      stroke: "none",
    });
    text.textContent = caption;
    svg.append(text);
  }
  return svg;
}

export function renderControllerBinding(
  element: HTMLElement,
  template: string,
  type: ControllerType = getControllerType() ?? "generic",
  swapAB?: boolean,
) {
  const tokens =
    /\{[a-z]+\}|\b(?:left|right)\s+stick(?:\s+(?:up|down|left|right)\b)?|\bD-pad(?:\s+(?:up|down|left|right)\b)?|\bstick\s+(?:up|down|left|right)\b/gi;
  const nodes: Node[] = [];
  let end = 0;
  for (const match of template.matchAll(tokens)) {
    if (match.index > end)
      nodes.push(document.createTextNode(template.slice(end, match.index)));
    const token = match[0];
    const label =
      token === "{confirm}"
        ? controllerMenuLabel("confirm", type, swapAB)
        : token === "{cancel}"
          ? controllerMenuLabel("back", type, swapAB)
          : controllerText(token, type, swapAB);
    const icon = document.createElement("span");
    icon.className = "controller-binding-icon";
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
    icon.title = label;
    icon.append(createControllerIcon(label));
    nodes.push(icon);
    end = match.index + token.length;
  }
  if (end < template.length)
    nodes.push(document.createTextNode(template.slice(end)));
  element.replaceChildren(...nodes);
}
