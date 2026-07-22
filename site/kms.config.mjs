export default {
  identity: { name: 'org—os/commons', emoji: '◉', accent: '#D6281E' },
  sources: [
    { id: 'org-os', label: 'Framework', emoji: '🧬', tagline: 'the protocol itself',
      dir: '..', content: ['docs/**/*.md'], exclude: ['**/node_modules/**', '**/superpowers/plans/**'],
      data: 'data', graph: 'graphify-out/graph.json' },
    { id: 'toolkit', label: 'Regen Toolkit', emoji: '🛠', tagline: 'jargon-free field guide',
      dir: '../../regen-coordination-os/repos/regen-toolkit', content: ['content/**/*.md'],
      exclude: ['**/working/**', '**/archive-pipeline-v1/**', '**/sources/**'],
      trails: 'src/data/journeys.js' },
    { id: 'refi-dao', label: 'ReFi DAO', emoji: '🌍', tagline: 'global coordination memory',
      dir: '../../refi-dao-os', content: ['knowledge/**/*.md'] },
    { id: 'refi-bcn', label: 'ReFi BCN', emoji: '🏙', tagline: 'local node',
      dir: '../../refi-bcn-os', content: ['knowledge/**/*.md'] },
  ],
  features: { trails: true, wander: true, deepCut: true, gaps: '../data/knowledge-gaps.yaml', registry: true, graph: true },
}
