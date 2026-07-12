/**
 * Stream Relay IPC — renderer ↔ main broker for the localhost RTMP relay.
 *
 * The renderer never talks to the relay child directly; it goes through these
 * handlers, which read/write config from electron-store and proxy events
 * from the RelayManager singleton via window-broadcasting.
 *
 * Boot semantics: on registration, if config has `streamRelayEnabled: true`,
 * we auto-start the manager so the relay is up as soon as the app is. The
 * renderer can later call `relay:enable`/`relay:disable` to toggle.
 */
import { ipcMain, BrowserWindow } from 'electron'
import { getStore } from './store'
import { relayManager, RelayConfig, RelayStatus, RelayStats } from '../services/streamRelay/relayManager'
import { activeBroadcastService, ActivePickResult } from '../services/streamRelay/activeBroadcast'
import { relayOrchestrator, OrchestratorEvent } from '../services/streamRelay/relayOrchestrator'

const YT_RTMP_BASE = 'rtmp://a.rtmp.youtube.com/live2'

function buildConfigFromStore(): RelayConfig | null {
  const cfg = getStore().get('config') as any
  if (!cfg?.streamRelayOutboundKey) return null
  return {
    port: cfg.streamRelayPort || 1935,
    inboundKey: cfg.streamRelayInboundKey || 'live',
    youtubeBase: YT_RTMP_BASE,
    outboundKey: cfg.streamRelayOutboundKey,
  }
}

/** Broadcast a payload to every open BrowserWindow. Mirrors how the converter
 *  and watcher fan out their events. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerStreamRelayIPC(): void {
  // ─── Event fan-out from manager → all renderer windows ─────────────────
  relayManager.on('status-change', (status: RelayStatus) => {
    broadcast('stream-relay:status', status)
  })
  relayManager.on('stats', (stats: RelayStats) => {
    broadcast('stream-relay:stats', stats)
  })
  relayManager.on('stream-started', () => {
    broadcast('stream-relay:stream-started', undefined)
  })
  relayManager.on('stream-stopped', (payload: { code: number | null }) => {
    broadcast('stream-relay:stream-stopped', payload)
  })
  relayManager.on('error', (msg: string) => {
    broadcast('stream-relay:error', msg)
  })

  // ─── Handlers ──────────────────────────────────────────────────────────

  ipcMain.handle('stream-relay:get-status', () => relayManager.getStatus())

  // Enable / disable just start/stop the manager — the renderer is responsible
  // for persisting `streamRelayEnabled` via setConfig BEFORE calling these,
  // so that its local config state stays in sync with the store (otherwise
  // the renderer would render stale "enabled" text until a full refresh).
  ipcMain.handle('stream-relay:enable', () => {
    const cfg = buildConfigFromStore()
    if (cfg) relayManager.start(cfg)
    return relayManager.getStatus()
  })

  ipcMain.handle('stream-relay:disable', () => {
    relayManager.stop()
    return relayManager.getStatus()
  })

  // Reapply config — used after the user updates the port/outbound key from
  // the UI. Triggers a clean restart if the relay is currently running.
  ipcMain.handle('stream-relay:reapply-config', () => {
    const cfg = getStore().get('config') as any
    if (!cfg?.streamRelayEnabled) return relayManager.getStatus()
    const next = buildConfigFromStore()
    if (next) relayManager.start(next)
    return relayManager.getStatus()
  })

  // ─── Active broadcast (picker) ─────────────────────────────────────────
  // Fetches the upcoming-broadcast list and computes the effective active
  // pick (manual override or soonest-upcoming auto-pick). Refresh forces
  // a YouTube API hit; otherwise the service serves from its 30s cache.
  ipcMain.handle('stream-relay:get-upcoming-broadcasts', async (_event, force = false) => {
    return activeBroadcastService.getUpcoming(force)
  })

  ipcMain.handle('stream-relay:get-active-broadcast', () => {
    return activeBroadcastService.getActive()
  })

  ipcMain.handle('stream-relay:set-active-broadcast', (_event, broadcastId: string | null) => {
    return activeBroadcastService.setManualPick(broadcastId)
  })

  // Fan-out for active-pick changes so widgets across windows update in lockstep
  activeBroadcastService.on('active-changed', (result: ActivePickResult) => {
    broadcast('stream-relay:active-changed', result)
  })
  activeBroadcastService.on('upcoming-changed', (list) => {
    broadcast('stream-relay:upcoming-changed', list)
  })

  // ─── Orchestrator lifecycle ─────────────────────────────────────────────
  // The orchestrator emits a single 'lifecycle' event for every state change
  // in the broadcast lifecycle (binding → going-live → live → grace →
  // completing → completed, plus error/no-broadcast variants). The widget
  // overlays these on top of the raw relay status to surface YouTube-side
  // context the user wouldn't otherwise see.
  relayOrchestrator.on('lifecycle', (ev: OrchestratorEvent) => {
    broadcast('stream-relay:lifecycle', ev)
  })

  // ─── Auto-start on registration ────────────────────────────────────────
  // If the user had the relay enabled when SM last quit, bring it back up.
  // No-op if config is incomplete (no outbound key yet).
  startRelayIfEnabled()
}

/** Start the relay when config says enabled and it isn't already up.
 *  Called at registration, and again when YouTube (re)connects — a relay
 *  that couldn't come up while disconnected gets its second chance without
 *  waiting for an app restart or a manual toggle. Never bounces a relay
 *  that's already listening/streaming. */
export function startRelayIfEnabled(): void {
  const cfg = getStore().get('config') as any
  if (!cfg?.streamRelayEnabled) return
  const state = relayManager.getStatus().state
  if (state !== 'idle' && state !== 'error') return
  const built = buildConfigFromStore()
  if (built) relayManager.start(built)
}
