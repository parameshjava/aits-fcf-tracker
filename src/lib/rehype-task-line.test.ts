import { describe, expect, it } from 'vitest'
import { stampTaskListSourceLines, type HastNode } from './rehype-task-line'

/** Build a task-list <li> at a given 1-based source line, with a checkbox. */
function taskItem(line: number, opts: { taskClass?: boolean; withPosition?: boolean; nested?: boolean } = {}): HastNode {
  const input: HastNode = {
    type: 'element',
    tagName: 'input',
    properties: { type: 'checkbox' },
    children: [],
  }
  const inner = opts.nested
    ? [{ type: 'element', tagName: 'p', properties: {}, children: [input] } as HastNode]
    : [input]
  return {
    type: 'element',
    tagName: 'li',
    properties: { className: opts.taskClass === false ? ['plain'] : ['task-list-item'] },
    position: opts.withPosition === false ? undefined : { start: { line } },
    children: inner,
  }
}

function tree(children: HastNode[]): HastNode {
  return { type: 'root', children }
}

function lineOf(node: HastNode): unknown {
  // find first checkbox input in subtree
  if (node.tagName === 'input' && node.properties?.type === 'checkbox') {
    return node.properties?.dataLine
  }
  for (const c of node.children ?? []) {
    const found = lineOf(c)
    if (found !== undefined) return found
  }
  return undefined
}

describe('stampTaskListSourceLines', () => {
  it('stamps a checkbox with the 0-based source line of its list item', () => {
    const li = taskItem(1)
    stampTaskListSourceLines(tree([li]))
    expect(lineOf(li)).toBe(0)
  })

  it('stamps multiple checkboxes at their own lines', () => {
    const a = taskItem(1)
    const b = taskItem(7)
    const c = taskItem(9)
    stampTaskListSourceLines(tree([a, b, c]))
    expect(lineOf(a)).toBe(0)
    expect(lineOf(b)).toBe(6)
    expect(lineOf(c)).toBe(8)
  })

  it('finds the checkbox even when nested inside a paragraph', () => {
    const li = taskItem(4, { nested: true })
    stampTaskListSourceLines(tree([li]))
    expect(lineOf(li)).toBe(3)
  })

  it('does not stamp a non-task list item', () => {
    const li = taskItem(2, { taskClass: false })
    stampTaskListSourceLines(tree([li]))
    expect(lineOf(li)).toBeUndefined()
  })

  it('skips items without position without crashing', () => {
    const li = taskItem(0, { withPosition: false })
    expect(() => stampTaskListSourceLines(tree([li]))).not.toThrow()
    expect(lineOf(li)).toBeUndefined()
  })
})
