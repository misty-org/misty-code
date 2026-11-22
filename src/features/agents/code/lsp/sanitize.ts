const KEPT = new Set([
  "P",
  "PRE",
  "CODE",
  "SPAN",
  "DIV",
  "EM",
  "STRONG",
  "B",
  "I",
  "DEL",
  "S",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "HR",
  "BR",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
]);

const DROPPED = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "FRAME",
  "OBJECT",
  "EMBED",
  "IMG",
  "PICTURE",
  "VIDEO",
  "AUDIO",
  "SVG",
  "MATH",
  "TEMPLATE",
  "LINK",
  "META",
  "BASE",
  "FORM",
  "INPUT",
  "BUTTON",
  "TEXTAREA",
  "SELECT",
  "NOSCRIPT",
]);

function clean(parent: Element): void {
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName.toUpperCase();
    if (DROPPED.has(tag)) {
      child.remove();
      continue;
    }
    clean(child);
    if (!KEPT.has(tag)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      if (attribute.name !== "class") child.removeAttribute(attribute.name);
    }
  }
}

export function sanitizeServerHtml(html: string): string {
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  clean(document.body);
  return document.body.innerHTML;
}
