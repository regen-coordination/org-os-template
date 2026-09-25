export function listMemory(files) {
  return Object.keys(files)
    .filter((k) => /^memory\/\d{4}-\d{2}-\d{2}.*\.md$/.test(k))
    .sort()
    .reverse()
    .map((path) => {
      const text = files[path] || "";
      const id = path.slice("memory/".length, -".md".length);
      return {
        id,
        date: id.slice(0, 10),
        path,
        title: (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() ?? null,
        focus: (text.match(/^\*\*Focus:\*\*\s*(.+)$/m) || [])[1]?.trim() ?? null,
      };
    });
}
