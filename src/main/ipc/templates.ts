import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import Store from 'electron-store'

export interface FolderNode {
  name: string
  children?: FolderNode[]
}

export interface TemplateVariable {
  key: string
  label: string
  defaultValue?: string
  type: 'text' | 'date' | 'select'
  options?: string[]
}

export interface FolderTemplate {
  id: string
  name: string
  description?: string
  structure: FolderNode[]
  variables: TemplateVariable[]
}

const store = new Store<{ templates: FolderTemplate[] }>({
  name: 'templates',
  defaults: {
    templates: getDefaultTemplates()
  }
})

function getDefaultTemplates(): FolderTemplate[] {
  return [
    {
      id: 'gaming-session',
      name: 'Gaming Session',
      description: 'Standard folder structure for a gaming stream session',
      variables: [
        { key: 'game', label: 'Game Name', type: 'text', defaultValue: 'MyGame' },
        { key: 'date', label: 'Date', type: 'date', defaultValue: '' },
        { key: 'streamer', label: 'Streamer Name', type: 'text', defaultValue: '' }
      ],
      structure: [
        {
          name: '{game} - {date}',
          children: [
            { name: 'Raw Footage' },
            { name: 'Edited' },
            { name: 'Highlights' },
            { name: 'Thumbnails' },
            { name: 'Assets', children: [
              { name: 'Music' },
              { name: 'SFX' },
              { name: 'Overlays' }
            ]}
          ]
        }
      ]
    },
    {
      id: 'vod-archive',
      name: 'VOD Archive',
      description: 'Archive structure organized by year and month',
      variables: [
        { key: 'year', label: 'Year', type: 'text', defaultValue: '2024' },
        { key: 'month', label: 'Month', type: 'select', options: [
          '01-January', '02-February', '03-March', '04-April',
          '05-May', '06-June', '07-July', '08-August',
          '09-September', '10-October', '11-November', '12-December'
        ], defaultValue: '01-January' },
        { key: 'game', label: 'Game', type: 'text', defaultValue: '' }
      ],
      structure: [
        {
          name: '{year}',
          children: [
            {
              name: '{month}',
              children: [
                { name: '{game}', children: [
                  { name: 'VODs' },
                  { name: 'Clips' },
                  { name: 'Exports' }
                ]}
              ]
            }
          ]
        }
      ]
    }
  ]
}

function applyVariables(str: string, variables: Record<string, string>): string {
  let result = str
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')

  // Built-in variables
  result = result.replace('{date}', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
  result = result.replace('{year}', String(now.getFullYear()))
  result = result.replace('{month}', pad(now.getMonth() + 1))
  result = result.replace('{day}', pad(now.getDate()))

  // User-provided variables
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  })

  return result
}

function createFolderTree(
  nodes: FolderNode[],
  basePath: string,
  variables: Record<string, string>
): void {
  for (const node of nodes) {
    const resolvedName = applyVariables(node.name, variables)
    // Sanitize folder name (remove characters invalid in Windows/Linux paths)
    const safeName = resolvedName.replace(/[<>:"/\\|?*]/g, '-')
    const fullPath = path.join(basePath, safeName)

    fs.mkdirSync(fullPath, { recursive: true })

    if (node.children && node.children.length > 0) {
      createFolderTree(node.children, fullPath, variables)
    }
  }
}

export function registerTemplatesIPC(): void {
  ipcMain.handle('templates:getAll', async () => {
    return store.get('templates', [])
  })

  ipcMain.handle('templates:save', async (_event, template: FolderTemplate) => {
    const templates = store.get('templates', [])
    const idx = templates.findIndex(t => t.id === template.id)
    if (idx >= 0) {
      templates[idx] = template
    } else {
      templates.push(template)
    }
    store.set('templates', templates)
  })

  ipcMain.handle('templates:delete', async (_event, id: string) => {
    const templates = store.get('templates', [])
    store.set('templates', templates.filter(t => t.id !== id))
  })

  ipcMain.handle(
    'templates:apply',
    async (_event, templateId: string, basePath: string, variables: Record<string, string>) => {
      const templates = store.get('templates', [])
      const template = templates.find(t => t.id === templateId)
      if (!template) throw new Error(`Template ${templateId} not found`)

      fs.mkdirSync(basePath, { recursive: true })
      createFolderTree(template.structure, basePath, variables)
    }
  )
}
