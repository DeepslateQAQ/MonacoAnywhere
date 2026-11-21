import { clone, generate, parse, walk } from "css-tree";

const uiRoot = parse(":where(.ma-ui)", { context: "selector" }).children.first;

/** Move token declarations onto UI roots without changing strings or URLs. */
export function retargetTokenRoots(source) {
  const ast = parse(source);
  walk(ast, {
    visit: "PseudoClassSelector",
    enter(node) {
      if (node.name.toLowerCase() === "root") Object.assign(node, clone(uiRoot));
    }
  });
  return generate(ast);
}

/** Keep import directives resolvable while confining component selectors. */
export function scopeComponentCss(source) {
  const ast = parse(source);
  const leading = [];
  const body = [];
  let hasBody = false;
  ast.children.forEach((node) => {
    const directive = node.type === "Atrule" &&
      ["import", "charset"].includes(node.name.toLowerCase());
    if (directive) {
      if (hasBody) throw new Error("UI CSS has an import after its style rules");
      leading.push(generate(node));
    } else {
      const layerOrder = node.type === "Atrule" &&
        node.name.toLowerCase() === "layer" && node.block === null;
      if (!layerOrder) hasBody = true;
      (hasBody ? body : leading).push(generate(node));
    }
  });
  return `${leading.join("\n")}\n@scope (:where(.ma-ui)) {${body.join("\n")}}\n`;
}
