/** Synthetic 102-unit family shared by the transport and D1 feasibility tests. */
export function largeImportFamilyDocument() {
  return JSON.stringify({
    exportedAt: '2026-10-26T00:00:00Z',
    entryCount: 1,
    entries: [
      {
        id: 'root',
        personalReading: 'Root',
        followUps: Array.from({ length: 101 }, (_, i) => ({
          turnNumber: i + 1,
          question: `Q${i}`,
          answer: '😀\\"'.repeat(1100),
        })),
      },
    ],
  });
}
