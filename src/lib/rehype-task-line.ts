// Rehype plugin: stamp each GFM task-list checkbox with the 0-based source line
// of its list item, as a `data-line` attribute.
//
// Why: the action-items panel needs to map a clicked checkbox back to the exact
// line in `action_items_md` to toggle. Re-deriving that mapping on the client
// with a regex is fragile — it disagrees with how `remark-gfm` actually renders
// checkboxes (a `[ ]` inside a code fence or a `- [ ]x` with no trailing space
// is NOT a checkbox to the renderer, but matches a naive regex), which silently
// desyncs the mapping. Stamping the line during the SAME render that produces
// the checkbox makes the mapping authoritative — the list item carries its
// source `position`, which we copy onto its checkbox.

export type HastNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  position?: { start?: { line?: number } }
  children?: HastNode[]
}

function firstCheckbox(node: HastNode): HastNode | null {
  if (
    node.type === 'element' &&
    node.tagName === 'input' &&
    node.properties?.type === 'checkbox'
  ) {
    return node
  }
  for (const child of node.children ?? []) {
    const found = firstCheckbox(child)
    if (found) return found
  }
  return null
}

function hasTaskListClass(node: HastNode): boolean {
  // hast stores className as a string or string[]; both stringify usefully.
  return String(node.properties?.className ?? '').includes('task-list-item')
}

/**
 * Walk a hast tree and, for every task-list `<li>` that carries a source
 * position, stamp its first descendant checkbox `<input>` with
 * `properties.dataLine = <0-based source line>`. Pure and idempotent.
 */
export function stampTaskListSourceLines(tree: HastNode): void {
  function visit(node: HastNode): void {
    if (
      node.type === 'element' &&
      node.tagName === 'li' &&
      hasTaskListClass(node) &&
      typeof node.position?.start?.line === 'number'
    ) {
      const input = firstCheckbox(node)
      if (input) {
        input.properties = input.properties ?? {}
        input.properties.dataLine = node.position.start.line - 1
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
}

/** Rehype plugin form, for `rehypePlugins={[rehypeTaskLine]}`. */
export function rehypeTaskLine() {
  return (tree: HastNode): void => stampTaskListSourceLines(tree)
}
