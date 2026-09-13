import type { ThumbnailLayer } from '../types'

/**
 * Layer grouping for the thumbnail editor (THU-18), on a FLAT layer list.
 *
 * A group is a layer of type 'group'; its members carry `parentId`. The
 * array stays the single source of truth: paint order is array order, a
 * group's members are stored as a contiguous block right after the group
 * entry (pre-order), and member positions are relative to their group, the
 * way Konva nests them. Keeping the list flat means undo, autosave,
 * templates, the clipboard, the font check, and the image preflight keep
 * iterating one array; only rendering, the layers panel, selection, and the
 * transformer know about nesting.
 *
 * Levels: a top-level group is level 1, a group inside it level 2, and so
 * on. `MAX_GROUP_LEVEL` caps nesting so the layers panel stays readable.
 */

export const MAX_GROUP_LEVEL = 3

export const isGroup = (l: ThumbnailLayer): boolean => l.type === 'group'
export const parentIdOf = (l: ThumbnailLayer): string | null => l.parentId ?? null

export function byId(layers: ThumbnailLayer[], id: string): ThumbnailLayer | undefined {
  return layers.find(l => l.id === id)
}

/** Direct members of `parentId` (null = top level), in storage order. */
export function childrenOf(layers: ThumbnailLayer[], parentId: string | null): ThumbnailLayer[] {
  return layers.filter(l => parentIdOf(l) === parentId)
}

/** The layer plus every descendant, as ids in storage order. */
export function subtreeIds(layers: ThumbnailLayer[], id: string): string[] {
  const set = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const l of layers) {
      if (l.parentId && set.has(l.parentId) && !set.has(l.id)) { set.add(l.id); grew = true }
    }
  }
  return layers.filter(l => set.has(l.id)).map(l => l.id)
}

/** Ancestors from the nearest parent outward. */
export function ancestorIds(layers: ThumbnailLayer[], id: string): string[] {
  const out: string[] = []
  let cur = byId(layers, id)
  const guard = new Set<string>()
  while (cur?.parentId && !guard.has(cur.parentId)) {
    guard.add(cur.parentId)
    out.push(cur.parentId)
    cur = byId(layers, cur.parentId)
  }
  return out
}

/** 1 for a top-level layer, 2 for a member of a top-level group, ... */
export function levelOf(layers: ThumbnailLayer[], id: string): number {
  return ancestorIds(layers, id).length + 1
}

export function topLevelAncestorId(layers: ThumbnailLayer[], id: string): string {
  const anc = ancestorIds(layers, id)
  return anc.length > 0 ? anc[anc.length - 1] : id
}

/** How many group levels a layer contains: 0 for a leaf, 1 for a group of
 *  leaves, 2 for a group holding a group, ... */
export function nestingHeight(layers: ThumbnailLayer[], id: string): number {
  const l = byId(layers, id)
  if (!l || !isGroup(l)) return 0
  const kids = childrenOf(layers, id)
  return 1 + kids.reduce((m, k) => Math.max(m, nestingHeight(layers, k.id)), 0)
}

export function hasHiddenAncestor(layers: ThumbnailLayer[], id: string): boolean {
  return ancestorIds(layers, id).some(a => byId(layers, a)?.visible === false)
}

/** Layers that actually paint: visible themselves and under no hidden group.
 *  For a renderer that is handed a filtered list (the background re-render). */
export function paintableLayers(layers: ThumbnailLayer[]): ThumbnailLayer[] {
  return layers.filter(l => l.visible !== false && !hasHiddenAncestor(layers, l.id))
}

/** The selected ids with every id that has a selected ancestor removed:
 *  the units a selection-wide operation (group, copy, duplicate) acts on. */
export function selectionRoots(layers: ThumbnailLayer[], ids: string[]): string[] {
  const set = new Set(ids)
  return ids.filter(id => byId(layers, id) && !ancestorIds(layers, id).some(a => set.has(a)))
}

/** Every layer inside the selected units, in storage order (for copy). */
export function selectionSubtreeLayers(layers: ThumbnailLayer[], ids: string[]): ThumbnailLayer[] {
  const roots = selectionRoots(layers, ids)
  const all = new Set(roots.flatMap(r => subtreeIds(layers, r)))
  return layers.filter(l => all.has(l.id))
}

// ── Grouping ───────────────────────────────────────────────────────────────

export function canGroup(layers: ThumbnailLayer[], ids: string[]): { ok: boolean; reason: string } {
  const roots = selectionRoots(layers, ids)
  if (roots.length < 2) return { ok: false, reason: 'Select two or more layers to group them' }
  const sel = roots.map(id => byId(layers, id)!).filter(Boolean)
  const parents = new Set(sel.map(parentIdOf))
  if (parents.size > 1) return { ok: false, reason: 'Layers in different groups cannot be grouped together; move them into the same group first' }
  const parentId = parentIdOf(sel[0])
  const newLevel = (parentId ? levelOf(layers, parentId) : 0) + 1
  const deepest = newLevel + sel.reduce((m, l) => Math.max(m, nestingHeight(layers, l.id)), 0)
  if (deepest > MAX_GROUP_LEVEL) return { ok: false, reason: `Groups can nest ${MAX_GROUP_LEVEL} levels deep at most` }
  return { ok: true, reason: '' }
}

export function canUngroup(layers: ThumbnailLayer[], ids: string[]): { ok: boolean; reason: string } {
  const roots = selectionRoots(layers, ids)
  if (roots.length === 0) return { ok: false, reason: 'Select a group to ungroup it' }
  if (!roots.every(id => isGroup(byId(layers, id)!))) return { ok: false, reason: roots.length === 1 ? 'The selected layer is not a group' : 'Only groups can be ungrouped; the selection also holds other layers' }
  return { ok: true, reason: '' }
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Wrap the selected units in a new group. `rectOf` returns each unit's
 * bounding box in its PARENT's coordinate space (the caller reads it from
 * the Konva node so rotated members and measured text are exact); it may
 * return null, in which case the layer's own x/y/width/height stand in.
 * The group lands where the topmost selected unit was, its origin at the
 * union's top-left, and the members' positions become group-relative.
 */
export function groupLayers(
  layers: ThumbnailLayer[],
  ids: string[],
  rectOf: (id: string) => Rect | null,
  makeId: () => string,
): { layers: ThumbnailLayer[]; groupId: string } | null {
  if (!canGroup(layers, ids).ok) return null
  const roots = selectionRoots(layers, ids)
  const rootSet = new Set(roots)
  const sel = layers.filter(l => rootSet.has(l.id))
  const parentId = parentIdOf(sel[0])
  const moving = new Set(roots.flatMap(r => subtreeIds(layers, r)))

  let minX = Infinity, minY = Infinity
  for (const l of sel) {
    const r = rectOf(l.id) ?? { x: l.x, y: l.y, width: l.width ?? 0, height: l.height ?? 0 }
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0 }

  const groupId = makeId()
  const group: ThumbnailLayer = {
    id: groupId, name: 'Group', type: 'group', visible: true, opacity: 100,
    x: minX, y: minY, rotation: 0,
    ...(parentId ? { parentId } : {}),
  }
  const moved = layers
    .filter(l => moving.has(l.id))
    .map(l => rootSet.has(l.id) ? { ...l, parentId: groupId, x: l.x - minX, y: l.y - minY } : l)
  const lastMovingIdx = layers.reduce((m, l, i) => (moving.has(l.id) ? i : m), -1)
  const insertAt = layers.slice(0, lastMovingIdx).filter(l => !moving.has(l.id)).length
  const remaining = layers.filter(l => !moving.has(l.id))
  return { layers: [...remaining.slice(0, insertAt), group, ...moved, ...remaining.slice(insertAt)], groupId }
}

/**
 * Dissolve a group: its direct members move up to the group's parent with
 * their positions and rotations composed with the group's, so nothing moves
 * on screen. Group opacity is folded into the members; a hidden group
 * leaves its members hidden. Returns the freed member ids for reselection.
 */
export function ungroupLayer(layers: ThumbnailLayer[], groupId: string): { layers: ThumbnailLayer[]; freed: string[] } | null {
  const g = byId(layers, groupId)
  if (!g || !isGroup(g)) return null
  const rad = ((g.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const freed: string[] = []
  const next = layers.filter(l => l.id !== groupId).map(l => {
    if (parentIdOf(l) !== groupId) return l
    freed.push(l.id)
    const { parentId: _drop, ...rest } = l
    void _drop
    return {
      ...rest,
      x: g.x + l.x * cos - l.y * sin,
      y: g.y + l.x * sin + l.y * cos,
      rotation: (l.rotation ?? 0) + (g.rotation ?? 0),
      opacity: Math.round(l.opacity * (g.opacity / 100)),
      visible: l.visible && g.visible,
      ...(g.parentId ? { parentId: g.parentId } : {}),
    }
  })
  return { layers: next, freed }
}

// ── Editing helpers ────────────────────────────────────────────────────────

/** Remove the given layers with their subtrees, then drop any group left
 *  without members (repeatedly, so a chain of now-empty groups collapses). */
export function deleteLayers(layers: ThumbnailLayer[], ids: string[]): ThumbnailLayer[] {
  const gone = new Set(ids.flatMap(id => subtreeIds(layers, id)))
  let next = layers.filter(l => !gone.has(l.id))
  for (;;) {
    const empty = next.filter(l => isGroup(l) && childrenOf(next, l.id).length === 0)
    if (empty.length === 0) return next
    const drop = new Set(empty.map(e => e.id))
    next = next.filter(l => !drop.has(l.id))
  }
}

/** Deep-copy a layer (a whole group when it is one) right above the source
 *  in its parent, with fresh ids and the root copy offset by 20 px. */
export function duplicateLayer(layers: ThumbnailLayer[], id: string, makeId: () => string): { layers: ThumbnailLayer[]; rootId: string } | null {
  const src = byId(layers, id)
  if (!src) return null
  const ids = subtreeIds(layers, id)
  const map = new Map(ids.map(i => [i, makeId()]))
  const copies = layers.filter(l => map.has(l.id)).map(l => ({
    ...l,
    id: map.get(l.id)!,
    ...(l.parentId && map.has(l.parentId) ? { parentId: map.get(l.parentId)! } : {}),
    ...(l.id === id ? { name: l.name + ' copy', x: l.x + 20, y: l.y + 20 } : {}),
  }))
  const lastIdx = layers.reduce((m, l, i) => (map.has(l.id) ? i : m), -1)
  return { layers: [...layers.slice(0, lastIdx + 1), ...copies, ...layers.slice(lastIdx + 1)], rootId: map.get(id)! }
}

/** The selection as clipboard content: every selected unit with its
 *  subtree, the units' own positions and rotations re-expressed in canvas
 *  space (a copied group member should paste where it was seen, not at
 *  its group-relative offset). */
export function copySelection(layers: ThumbnailLayer[], ids: string[]): ThumbnailLayer[] {
  const roots = new Set(selectionRoots(layers, ids))
  return selectionSubtreeLayers(layers, ids).map(l => {
    if (!roots.has(l.id) || !l.parentId) return l
    const { parentId, ...rest } = l
    return { ...rest, ...reparentTransform(layers, l, parentId, null) }
  })
}

/**
 * Insert freshly cloned clipboard layers above `anchorId` (THU-24): in the
 * anchor's parent, directly above it in paint order, with the pasted units'
 * canvas-space positions re-expressed in that parent's frame. Falls back to
 * the anchor's top-level ancestor when a pasted group would nest past the
 * limit, and to the top of the stack when there is no anchor.
 */
export function insertPastedAbove(layers: ThumbnailLayer[], pasted: ThumbnailLayer[], anchorId: string | null): { layers: ThumbnailLayer[]; rootIds: string[] } {
  const roots = pasted.filter(l => !l.parentId)
  const rootIds = roots.map(r => r.id)
  const anchor = anchorId ? byId(layers, anchorId) : undefined
  if (!anchor) return { layers: [...layers, ...pasted], rootIds }
  let parentId = parentIdOf(anchor)
  let after = anchor
  if (parentId && roots.some(r => isGroup(r) && levelOf(layers, parentId!) + nestingHeight(pasted, r.id) > MAX_GROUP_LEVEL)) {
    parentId = null
    after = byId(layers, topLevelAncestorId(layers, anchor.id)) ?? anchor
  }
  const placed = parentId
    ? pasted.map(l => roots.includes(l) ? { ...l, ...reparentTransform(layers, l, null, parentId), parentId } : l)
    : pasted
  const block = subtreeIds(layers, after.id)
  const idx = layers.findIndex(l => l.id === block[block.length - 1])
  return { layers: [...layers.slice(0, idx + 1), ...placed, ...layers.slice(idx + 1)], rootIds }
}

/** Fresh-id copies of the given subtrees for pasting: roots land at the top
 *  level; inner parent links are remapped. */
export function clonePasteLayers(subtree: ThumbnailLayer[], makeId: () => string): ThumbnailLayer[] {
  const map = new Map(subtree.map(l => [l.id, makeId()]))
  return subtree.map(l => {
    const { parentId, ...rest } = l
    return {
      ...rest,
      id: map.get(l.id)!,
      ...(parentId && map.has(parentId) ? { parentId: map.get(parentId)! } : {}),
    }
  })
}

/** The coordinate frame a member of `parentId` lives in, in canvas space:
 *  the composition of every enclosing group's position and rotation
 *  (groups carry no scale; it is baked into members on release). A point
 *  p in that frame sits at origin + rotate(p, rotation) on the canvas. */
export function frameOf(layers: ThumbnailLayer[], parentId: string | null): { x: number; y: number; rotation: number } {
  if (!parentId) return { x: 0, y: 0, rotation: 0 }
  const chain = [parentId, ...ancestorIds(layers, parentId)].reverse() // outermost first
  let x = 0, y = 0, rotation = 0
  for (const gid of chain) {
    const g = byId(layers, gid)
    if (!g) continue
    const rad = (rotation * Math.PI) / 180
    x += g.x * Math.cos(rad) - g.y * Math.sin(rad)
    y += g.x * Math.sin(rad) + g.y * Math.cos(rad)
    rotation += g.rotation ?? 0
  }
  return { x, y, rotation }
}

/** Re-express a layer's position and rotation from one parent's frame in
 *  another's, so a move between groups leaves it where it was on screen. */
export function reparentTransform(layers: ThumbnailLayer[], layer: ThumbnailLayer, fromParent: string | null, toParent: string | null): { x: number; y: number; rotation: number } {
  const a = frameOf(layers, fromParent)
  const b = frameOf(layers, toParent)
  const ra = (a.rotation * Math.PI) / 180
  const wx = a.x + layer.x * Math.cos(ra) - layer.y * Math.sin(ra)
  const wy = a.y + layer.x * Math.sin(ra) + layer.y * Math.cos(ra)
  const rb = (-b.rotation * Math.PI) / 180
  const dx = wx - b.x, dy = wy - b.y
  return {
    x: dx * Math.cos(rb) - dy * Math.sin(rb),
    y: dx * Math.sin(rb) + dy * Math.cos(rb),
    rotation: (layer.rotation ?? 0) + a.rotation - b.rotation,
  }
}

/**
 * Move a layer (with its subtree) under `parentId` (null = top level),
 * placed directly above `afterId` in paint order, or at the very bottom of
 * that parent when `afterId` is null. A move between parents re-expresses
 * the layer's position and rotation in the new parent's frame so it stays
 * put on screen. Refuses a move into its own subtree and one that would
 * nest groups past `MAX_GROUP_LEVEL`. Returns null when refused or when
 * nothing changes.
 */
export function moveLayerTo(layers: ThumbnailLayer[], id: string, parentId: string | null, afterId: string | null): ThumbnailLayer[] | null {
  const src = byId(layers, id)
  if (!src) return null
  const block = new Set(subtreeIds(layers, id))
  if (parentId && block.has(parentId)) return null
  if (afterId && block.has(afterId)) return null
  if (parentId) {
    const p = byId(layers, parentId)
    if (!p || !isGroup(p)) return null
    if (isGroup(src) && levelOf(layers, parentId) + nestingHeight(layers, id) > MAX_GROUP_LEVEL) return null
  }
  // Keep object identity when the parent does not change, so a drop back
  // into the same slot is detected as "nothing changed" below.
  const moving = layers.filter(l => block.has(l.id)).map(l => {
    if (l.id !== id || parentIdOf(l) === parentId) return l
    const { parentId: _old, ...rest } = l
    void _old
    const placed = { ...rest, ...reparentTransform(layers, l, parentIdOf(l), parentId) }
    return parentId ? { ...placed, parentId } : placed
  })
  const remaining = layers.filter(l => !block.has(l.id))
  let insertAt: number
  if (afterId) {
    const afterBlock = subtreeIds(remaining, afterId)
    const last = afterBlock[afterBlock.length - 1]
    insertAt = remaining.findIndex(l => l.id === last) + 1
    if (insertAt === 0) return null
  } else if (parentId) {
    insertAt = remaining.findIndex(l => l.id === parentId) + 1
    if (insertAt === 0) return null
  } else {
    insertAt = 0
  }
  const next = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
  const same = next.length === layers.length && next.every((l, i) => l === layers[i])
  return same ? null : next
}

/** Z-order step among siblings (the bracket keys and the panel arrows). */
export function moveAmongSiblings(layers: ThumbnailLayer[], id: string, direction: 'up' | 'down' | 'top' | 'bottom'): ThumbnailLayer[] | null {
  const l = byId(layers, id)
  if (!l) return null
  const parentId = parentIdOf(l)
  const siblings = childrenOf(layers, parentId)
  const i = siblings.findIndex(s => s.id === id)
  if (i === -1) return null
  let afterId: string | null
  switch (direction) {
    case 'up':     if (i === siblings.length - 1) return null; afterId = siblings[i + 1].id; break
    case 'down':   if (i === 0) return null; afterId = i >= 2 ? siblings[i - 2].id : null; break
    case 'top':    if (i === siblings.length - 1) return null; afterId = siblings[siblings.length - 1].id; break
    default:       if (i === 0) return null; afterId = null
  }
  return moveLayerTo(layers, id, parentId, afterId)
}

/** Bake a group's transformer scale into its members: positions and sizes
 *  scale, text scales its font size, nested groups pass the scale on.
 *  Strokes, corner radii, and shadows stay in pixels, as they do when a
 *  single layer is resized. */
export function scaleGroupMembers(layers: ThumbnailLayer[], groupId: string, sx: number, sy: number): ThumbnailLayer[] {
  if (sx === 1 && sy === 1) return layers
  const inside = new Set(subtreeIds(layers, groupId))
  inside.delete(groupId)
  return layers.map(l => {
    if (!inside.has(l.id)) return l
    const out: ThumbnailLayer = { ...l, x: l.x * sx, y: l.y * sy }
    if (isGroup(l)) return out
    if (l.width !== undefined) out.width = Math.max(1, Math.round(l.width * sx))
    if (l.type === 'text') {
      const s = (sx + sy) / 2
      out.fontSize = Math.max(1, Math.round((l.fontSize ?? 48) * s * 100) / 100)
    } else if (l.height !== undefined) {
      out.height = Math.max(1, Math.round(l.height * sy))
    }
    return out
  })
}

/** True when resizing this selection must keep its aspect: a group whose
 *  members include text (no stretch model) or a rotated layer (a
 *  non-uniform scale would need a skew we do not store). */
export function needsUniformScale(layers: ThumbnailLayer[], ids: string[]): boolean {
  return ids.some(id => {
    const l = byId(layers, id)
    if (!l || !isGroup(l)) return false
    return subtreeIds(layers, id).some(d => {
      if (d === id) return false
      const m = byId(layers, d)!
      return m.type === 'text' || (m.rotation ?? 0) !== 0
    })
  })
}

// ── Layers panel rows ──────────────────────────────────────────────────────

export interface PanelRow { layer: ThumbnailLayer; depth: number; parentId: string | null }

/** Top-to-bottom rows for the layers panel: each parent's members in
 *  reverse storage order (topmost first), members of a collapsed group
 *  left out. */
export function panelRows(layers: ThumbnailLayer[], collapsed: ReadonlySet<string>): PanelRow[] {
  const rows: PanelRow[] = []
  const visit = (parentId: string | null, depth: number) => {
    const kids = childrenOf(layers, parentId)
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i]
      rows.push({ layer: k, depth, parentId })
      if (isGroup(k) && !collapsed.has(k.id)) visit(k.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}
