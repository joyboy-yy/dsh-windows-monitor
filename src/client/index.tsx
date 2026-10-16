/**
 * Client half: register the monitor panel into the frame-wide overlay slot.
 *
 * `shell.overlay` is deliberately click-through — the layer itself never blocks
 * the app, and each entry opts back into pointer events. That is exactly the
 * contract a corner status surface needs.
 */

import type { ClientPluginContext } from './harness.js'
import { Monitor } from './Monitor.js'
import { PANEL_CSS } from './styles.js'

/** Cordis services the client half cannot start without. */
export const inject = ['slots', 'timer'] as const

/** Target slot: the frame-wide floating layer above every column. */
const SLOT = 'shell.overlay'

/** This entry's cell key. A fresh id is added beside the shipped entries. */
const SLOT_ID = 'windows-local-monitor'

/** Register the panel and own the stylesheet for this plugin's lifetime. */
export function apply(ctx: ClientPluginContext): void {
  const style = document.createElement('style')
  style.dataset.dshSystemMonitor = 'true'
  style.textContent = PANEL_CSS
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'windows-monitor: styles')

  ctx.slots.inject(SLOT, () =>
    ctx.slots.register({ name: SLOT, id: SLOT_ID, order: 20, label: '本机状态' }, () => <Monitor ctx={ctx} />),
  )
}
