// src/certified/leaflet.mjs — plain text → a Leaflet document, the body format of Certified feed posts.
// Shape read from a real public post (test/fixtures/certified/feed-post.json): a pub.leaflet.pages.linearDocument whose
// blocks are { $type: '…#block', block: { $type: 'pub.leaflet.blocks.text', plaintext } }. Pure. Text only: no images, no links.

/** One text block per paragraph (blank-line separated); a line break inside a paragraph is kept. An empty text is refused. */
export function textToLeaflet(text) {
  const paragraphs = String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) throw new Error('textToLeaflet: the text is empty');
  return {
    $type: 'pub.leaflet.pages.linearDocument',
    blocks: paragraphs.map((plaintext) => ({
      $type: 'pub.leaflet.pages.linearDocument#block',
      block: { $type: 'pub.leaflet.blocks.text', plaintext },
    })),
  };
}
