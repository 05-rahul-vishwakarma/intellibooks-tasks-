import type { ChatSource } from "@/lib/api";

export interface GroupedSource extends ChatSource {
  /** Number of retrieved chunks that belong to this page. */
  count: number;
}

/**
 * The backend returns one source per retrieved chunk, so several chunks can
 * belong to the same page. Collapse them into a single citation per page and
 * merge their content (de-duplicating identical passages).
 */
export function groupSourcesByPage(sources: ChatSource[]): GroupedSource[] {
  const byPage = new Map<number, { contents: string[]; count: number }>();

  for (const source of sources) {
    const page = typeof source.page_number === "number" ? source.page_number : 0;
    const entry = byPage.get(page) ?? { contents: [], count: 0 };
    entry.count += 1;

    const content = (source.content ?? "").trim();
    if (content && !entry.contents.includes(content)) {
      entry.contents.push(content);
    }

    byPage.set(page, entry);
  }

  return Array.from(byPage.entries())
    .sort(([a], [b]) => a - b)
    .map(([page, entry]) => ({
      page_number: page,
      content: entry.contents.join("\n\n"),
      count: entry.count,
    }));
}
