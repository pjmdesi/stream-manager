import React, { useState, useEffect, useCallback } from 'react'
import { Plus, FolderOpen, Trash2, Play, ChevronRight } from 'lucide-react'
import type { FolderTemplate, FolderNode, TemplateVariable } from '../../types'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'

function FolderTree({ nodes, depth = 0 }: { nodes: FolderNode[]; depth?: number }) {
  return (
    <div>
      {nodes.map((node, i) => (
        <div key={i}>
          <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
            <ChevronRight size={12} className={`text-gray-600 ${node.children?.length ? '' : 'opacity-0'}`} />
            <FolderOpen size={12} className="text-yellow-600/70" />
            <span className="text-xs text-gray-400 font-mono">{node.name}</span>
          </div>
          {node.children && <FolderTree nodes={node.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  )
}

function ApplyModal({
  template,
  onClose,
}: {
  template: FolderTemplate
  onClose: () => void
}) {
  const [basePath, setBasePath] = useState('')
  const [vars, setVars] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    template.variables.forEach(v => {
      init[v.key] = v.defaultValue || ''
    })
    return init
  })
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const pickDir = async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) setBasePath(dir)
  }

  const apply = async () => {
    if (!basePath) { setError('Please select a base directory.'); return }
    setApplying(true)
    setError('')
    try {
      await window.api.applyTemplate(template.id, basePath, vars)
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Apply: ${template.name}`}
      width="md"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={apply} loading={applying}>Create Folders</Button>
          </>
        )
      }
    >
      {done ? (
        <div className="text-green-400 text-sm py-4 text-center">Folders created successfully!</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Base Directory</label>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                value={basePath}
                onChange={e => setBasePath(e.target.value)}
                placeholder="Select or type a path…"
              />
              <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir}>
                Browse
              </Button>
            </div>
          </div>

          {template.variables.map(v => (
            <Input
              key={v.key}
              label={v.label}
              value={vars[v.key] || ''}
              onChange={e => setVars(prev => ({ ...prev, [v.key]: e.target.value }))}
              placeholder={v.defaultValue}
            />
          ))}

          <div className="border border-white/10 rounded-lg p-3 bg-navy-900">
            <div className="text-xs text-gray-500 mb-2">Preview structure:</div>
            <FolderTree nodes={template.structure} />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

function EditModal({
  template,
  onClose,
  onSave,
}: {
  template: FolderTemplate | null
  onClose: () => void
  onSave: (t: FolderTemplate) => void
}) {
  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [structureJson, setStructureJson] = useState(
    JSON.stringify(template?.structure || [], null, 2)
  )
  const [variablesJson, setVariablesJson] = useState(
    JSON.stringify(template?.variables || [], null, 2)
  )
  const [error, setError] = useState('')

  const save = () => {
    try {
      const structure = JSON.parse(structureJson)
      const variables = JSON.parse(variablesJson)
      const id = template?.id || `tmpl-${Date.now()}`
      onSave({ id, name, description, structure, variables })
    } catch (e: any) {
      setError('Invalid JSON: ' + e.message)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={template ? 'Edit Template' : 'New Template'}
      width="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Description" value={description} onChange={e => setDescription(e.target.value)} />
        <Textarea
          label='Structure (JSON array of FolderNode)'
          value={structureJson}
          onChange={e => setStructureJson(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          hint='[{ "name": "MyFolder", "children": [{ "name": "Sub" }] }]'
        />
        <Textarea
          label='Variables (JSON array)'
          value={variablesJson}
          onChange={e => setVariablesJson(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          hint='[{ "key": "game", "label": "Game Name", "type": "text", "defaultValue": "" }]'
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}

export function TemplatesPage() {
  const [templates, setTemplates] = useState<FolderTemplate[]>([])
  const [applying, setApplying] = useState<FolderTemplate | null>(null)
  const [editing, setEditing] = useState<FolderTemplate | null | 'new'>('none' as any)
  const [showEdit, setShowEdit] = useState(false)

  const refresh = useCallback(() => {
    window.api.getTemplates().then(setTemplates)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async (t: FolderTemplate) => {
    await window.api.saveTemplate(t)
    setShowEdit(false)
    setEditing(null)
    refresh()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await window.api.deleteTemplate(id)
    refresh()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Folder Templates</h1>
          <p className="text-xs text-gray-500 mt-0.5">Create folder structures for new streaming sessions</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => { setEditing(null); setShowEdit(true) }}
        >
          New Template
        </Button>
      </div>

      <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto p-6">
        {templates.length === 0 ? (
          <div className="text-center text-gray-600 py-16">No templates yet. Create one to get started.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {templates.map(t => (
              <div key={t.id} className="bg-navy-800 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
                <div>
                  <div className="font-medium text-gray-200">{t.name}</div>
                  {t.description && <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>}
                </div>

                <div className="border border-white/5 rounded-lg p-2 bg-navy-900 flex-1">
                  <FolderTree nodes={t.structure} />
                </div>

                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.variables.map(v => (
                      <span key={v.key} className="text-xs bg-purple-900/30 text-purple-300 px-2 py-0.5 rounded border border-purple-300/40">
                        {'{' + v.key + '}'}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={12} />}
                    onClick={() => setApplying(t)}
                    className="flex-1"
                  >
                    Apply
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setEditing(t); setShowEdit(true) }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={12} />}
                    onClick={() => handleDelete(t.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div></div>

      {applying && (
        <ApplyModal template={applying} onClose={() => setApplying(null)} />
      )}
      {showEdit && (
        <EditModal
          template={editing as FolderTemplate | null}
          onClose={() => { setShowEdit(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
