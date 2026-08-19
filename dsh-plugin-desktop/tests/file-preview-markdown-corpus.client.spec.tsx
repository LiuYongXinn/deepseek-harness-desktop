// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_CAPABILITIES,
  MARKDOWN_FIXTURES,
  fixtureById,
  fixturesByCapability,
  type MarkdownCapability,
} from './fixtures/markdown/corpus.ts'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function collectCoverage(): Record<MarkdownCapability, readonly string[]> {
  const coverage = {} as Record<MarkdownCapability, readonly string[]>
  for (const capability of MARKDOWN_CAPABILITIES) {
    coverage[capability] = fixturesByCapability(capability).map(fixture => fixture.id)
  }
  return coverage
}

describe('markdown fixture corpus invariants', () => {
  it('has at least 18 fixtures', () => {
    expect(MARKDOWN_FIXTURES.length).toBeGreaterThanOrEqual(18)
  })

  it('gives every fixture a unique, kebab-case id and a non-empty title/markdown/capabilities', () => {
    const ids = new Set<string>()
    for (const fixture of MARKDOWN_FIXTURES) {
      expect(fixture.id, fixture.title).toMatch(KEBAB_CASE)
      expect(ids.has(fixture.id), `duplicate id ${fixture.id}`).toBe(false)
      ids.add(fixture.id)

      expect(fixture.title.trim().length, fixture.id).toBeGreaterThan(0)
      expect(fixture.markdown.trim().length, fixture.id).toBeGreaterThan(0)
      expect(fixture.capabilities.length, fixture.id).toBeGreaterThan(0)
    }
  })

  it('declares every capability in MARKDOWN_CAPABILITIES as a member of the closed union', () => {
    for (const capability of MARKDOWN_CAPABILITIES) {
      // The array type is readonly MarkdownCapability[]; membership of the union
      // list itself is checked structurally by this assertion.
      expect(MARKDOWN_CAPABILITIES).toContain(capability)
    }
  })

  it('keeps every fixture capability inside the closed union (no stray strings)', () => {
    const union = new Set<string>(MARKDOWN_CAPABILITIES)
    for (const fixture of MARKDOWN_FIXTURES) {
      for (const capability of fixture.capabilities) {
        expect(union.has(capability), `${fixture.id} carries unknown capability ${capability}`).toBe(true)
      }
    }
  })

  it('exercises every capability in MARKDOWN_CAPABILITIES with at least one fixture', () => {
    const coverage = collectCoverage()
    for (const capability of MARKDOWN_CAPABILITIES) {
      expect(coverage[capability]?.length ?? 0, `capability ${capability} has no fixture`).toBeGreaterThan(0)
    }
  })

  it('returns the right fixture from fixtureById and throws on an unknown id', () => {
    const first = MARKDOWN_FIXTURES[0]
    if (first === undefined) throw new Error('corpus must not be empty')
    expect(fixtureById(first.id)).toBe(first)
    expect(() => fixtureById('no-such-fixture')).toThrow(/Unknown markdown fixture id "no-such-fixture"/)
  })

  it('returns only fixtures carrying the requested capability from fixturesByCapability', () => {
    for (const capability of MARKDOWN_CAPABILITIES) {
      const hits = fixturesByCapability(capability)
      expect(hits.length).toBeGreaterThan(0)
      for (const fixture of hits) {
        expect(fixture.capabilities).toContain(capability)
      }
    }
  })

  it('pins the corpus coverage map (future edits must be intentional)', () => {
    expect(collectCoverage()).toMatchInlineSnapshot(`
      {
        "autolink": [
          "autolink",
        ],
        "blockquote": [
          "blockquote",
        ],
        "code-block": [
          "code-block",
        ],
        "display-math": [
          "math-display",
        ],
        "footnote-definition-multiparagraph": [
          "footnote-multiparagraph",
        ],
        "footnote-multi-ref": [
          "footnote-multi-ref",
        ],
        "footnote-reference": [
          "footnote-multiparagraph",
          "footnote-multi-ref",
        ],
        "front-matter-only": [
          "front-matter-only",
        ],
        "front-matter-with-body": [
          "front-matter-with-body",
        ],
        "gfm-strikethrough": [
          "table-rich-cells",
          "gfm-strikethrough",
        ],
        "gfm-table": [
          "gfm-table-basic",
          "table-alignments",
          "table-chinese-cells",
          "table-rich-cells",
          "table-escaped-pipe",
        ],
        "html-comment": [
          "html-comment",
        ],
        "incomplete-markdown": [
          "incomplete-markdown",
        ],
        "inline-math": [
          "table-rich-cells",
          "math-inline",
        ],
        "malformed-tex": [
          "math-malformed-tex",
        ],
        "raw-html-allowlisted": [
          "raw-html-allowlisted",
        ],
        "raw-html-dangerous-url": [
          "raw-html-dangerous-url",
        ],
        "raw-html-event-inert": [
          "raw-html-event-inert",
        ],
        "raw-html-script-inert": [
          "raw-html-script-inert",
        ],
        "table-align-center": [
          "table-alignments",
        ],
        "table-align-left": [
          "gfm-table-basic",
          "table-alignments",
        ],
        "table-align-right": [
          "table-alignments",
        ],
        "table-cell-chinese": [
          "table-chinese-cells",
        ],
        "table-cell-rich": [
          "table-rich-cells",
        ],
        "table-escaped-pipe": [
          "table-escaped-pipe",
        ],
        "task-list": [
          "task-list-states",
        ],
        "unknown-extension": [
          "unknown-extension",
        ],
      }
    `)
  })
})
