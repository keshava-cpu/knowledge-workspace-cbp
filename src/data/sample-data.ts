export type DocumentStatus = 'Processed' | 'Ingesting' | 'Queued' | 'Needs review'

export interface DocumentItem {
  id: string
  title: string
  type: 'Textbook' | 'Research paper' | 'Lecture notes' | 'Scan'
  updated: string
  status: DocumentStatus
  progress?: number
  pages: number
}

export interface SearchResult {
  id: string
  title: string
  section: string
  page: string
  excerpt: string
  documentType: string
  matchType: 'Semantic' | 'Keyword' | 'Hybrid'
}

export const documents: DocumentItem[] = [
  {
    id: 'neural-systems',
    title: 'Neural Systems and Memory',
    type: 'Textbook',
    updated: '2 hours ago',
    status: 'Processed',
    pages: 212,
  },
  {
    id: 'computational-vision',
    title: 'Computational Vision Foundations',
    type: 'Research paper',
    updated: 'Yesterday',
    status: 'Ingesting',
    progress: 72,
    pages: 88,
  },
  {
    id: 'ml-practical',
    title: 'ML in Practice: Lab Notes',
    type: 'Lecture notes',
    updated: '3 days ago',
    status: 'Needs review',
    pages: 54,
  },
  {
    id: 'stats-scan',
    title: 'Statistics Review Scan',
    type: 'Scan',
    updated: '1 week ago',
    status: 'Queued',
    pages: 118,
  },
]

export const bookSections = [
  { id: 'overview', label: 'Overview', page: 1 },
  { id: 'mechanisms', label: 'Memory mechanisms', page: 18 },
  { id: 'neural-circuits', label: 'Neural circuits', page: 42 },
  { id: 'encoding', label: 'Encoding and retrieval', page: 77 },
  { id: 'case-studies', label: 'Case studies', page: 116 },
  { id: 'applications', label: 'Applications', page: 154 },
]

export const searchResults: SearchResult[] = [
  {
    id: 'r1',
    title: 'Neural Systems and Memory',
    section: 'Encoding and retrieval',
    page: 'p. 81',
    excerpt:
      'Memory formation depends on the repeated activation of hippocampal ensembles, where synaptic plasticity strengthens the associations between concept and context.',
    documentType: 'Textbook',
    matchType: 'Semantic',
  },
  {
    id: 'r2',
    title: 'Computational Vision Foundations',
    section: 'Feature hierarchies',
    page: 'p. 29',
    excerpt:
      'The visual system relies on hierarchical feature extraction to discriminate patterns before semantic labels are assigned to observed objects.',
    documentType: 'Research paper',
    matchType: 'Hybrid',
  },
  {
    id: 'r3',
    title: 'ML in Practice: Lab Notes',
    section: 'Experiment design',
    page: 'p. 14',
    excerpt:
      'Cross-validation helps estimate generalization error, but the model and the retrieval targets must be aligned with the original question being asked.',
    documentType: 'Lecture notes',
    matchType: 'Keyword',
  },
]

export const markdownDraft = `# Reading notes

## Key ideas

- Memory traces become more robust when contextual cues are repeated.
- Retrieval quality improves when the original task structure is preserved.
- Contrastive learning encourages representations that distinguish semantic neighbors.

## Questions

> Which evidence in this chapter is strongest for the role of repetition in learning?

### Follow-up

- Compare the hippocampal explanation with the cortical consolidation account.
- Note which findings appear in the later experiments and how they differ from earlier claims.
`

export const bookContent = [
  {
    title: 'Overview',
    paragraphs: [
      'Learning begins with the organization of sensory evidence into stable patterns of meaning. The brain does not store a single copy of a fact so much as a network of associated traces that can be reactivated under the right conditions.',
      'This chapter introduces the mechanisms by which repeated exposure strengthens representations and how attention, expectation and novelty reshape the path to retrieval. The discussion centers on the relationship between short-term encoding and durable memory formation.',
    ],
  },
  {
    title: 'Memory mechanisms',
    paragraphs: [
      'Evidence from neurobiology suggests that memory consolidation depends on coordinated activity between the hippocampus and cortical networks. When an experience is first encoded, the hippocampal system binds distributed features into a cohesive representation.',
      'Over time, these representations are replayed and integrated into broader cortical schemas. The result is a stronger ability to retrieve associated concepts without necessarily reactivating every original sensory cue.',
    ],
  },
  {
    title: 'Encoding and retrieval',
    paragraphs: [
      'Retrieval is most effective when the original context is partially reinstated. This explains why cues such as location, emotional tone and prior analogies make memory easier to access.',
      'In practice, the best learning systems combine repetition, spaced review and context-rich prompts. Those strategies make retrieval more reliable and help translate the material from familiarity into durable understanding.',
    ],
  },
]
