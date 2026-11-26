// remark-strip-title.mjs — every doc opens with its own "# Title". The docs
// layout prints the title from the manifest, so the document's leading h1 is
// dropped to leave one h1 on the page. An h1 further down is left alone.
export default function remarkStripTitle() {
  return (tree) => {
    const i = tree.children.findIndex((n) => n.type !== "html" && n.type !== "yaml");
    if (i !== -1 && tree.children[i].type === "heading" && tree.children[i].depth === 1) {
      tree.children.splice(i, 1);
    }
  };
}
