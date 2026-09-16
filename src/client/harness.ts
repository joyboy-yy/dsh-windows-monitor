/**
 * Structural declarations for the client-side harness seams.
 *
 * Same rationale as `../harness.ts`: DSH's client packages are not published to
 * npm at the version the harness ships, so the plugin declares the small
 * surface it calls and stays dependency-free.
 */

import type { ReactElement } from 'react'

/** Disposer returned by every Cordis lifecycle registration. */
export type Disposable = () => void

/** Registration options of the `shell.overlay` list slot. */
export interface SlotRegistration {
  /** Slot key being targeted. */
  name: string
  /** This entry's cell key. A fresh id is added beside the shipped entries. */
  id: string
  /** Position among the entries, ascending. */
  order?: number
  /** Display text where the owner projects one. */
  label?: string | (() => string)
}

/** Slot registry seam. */
export interface SlotsService {
  /** Run `callback` once the named slot is declared. */
  inject(name: string, callback: () => Disposable): Disposable
  /** Register a renderer into a slot. */
  register(options: SlotRegistration, renderer: () => ReactElement | null): Disposable
}

/** The Cordis context slice the client half is applied with. */
export interface ClientPluginContext {
  effect(callback: () => Disposable | void, label?: string): Disposable
  interval(callback: () => void, ms: number): Disposable
  readonly slots: SlotsService
}
