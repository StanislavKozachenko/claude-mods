import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TurnStats } from '../types'
import { addCall, emptyStats, keepNewest, summarize } from './stats'

const lines = atom({ plugin: 'turn-stats', key: 'lines' } as const, {})

/** Summaries kept across sessions, so a resumed transcript keeps them. */
const STORE_KEY = 'lines'
const MAX_LINES = 200

/** The main turn running now. */
let current: TurnStats | undefined
let costAtStart: number | undefined
/** The turn that just completed, waiting for its turn_duration row. */
let pending: TurnStats | undefined

async function sessionCost($: EngineInterface) {
  return (await $.session.usage()).cost?.usd
}

/** The running turn as it stands, with what it cost so far. */
async function settle($: EngineInterface, stats: TurnStats): Promise<TurnStats> {
  const costAtEnd = await sessionCost($)
  const costUsd = costAtEnd !== undefined && costAtStart !== undefined ? costAtEnd - costAtStart : undefined

  return { ...stats, ...(costUsd === undefined ? {} : { costUsd }) }
}

/** Subagents run turns of their own inside the main one; only the main turn is summarized. */
const isSubagent = (e: object) => 'agentId' in e && e.agentId !== undefined

export const register: Register = (on, options) => {
  const topTools = Math.max(0, Number(options.topTools ?? 3))
  const isCostShown = options.cost !== false

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    if (stored !== null && typeof stored === 'object') {
      await update($, lines, record => ({ ...(stored as Record<string, TurnStats>), ...record }))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!isSubagent(e)) {
      current = emptyStats()
      costAtStart = await sessionCost($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (current) {
      const isFailed = ran.deny !== undefined || ran.isError === true
      current = addCall(current, String(e.tool), e as Readonly<Record<string, unknown>>, isFailed)
    }

    return ran
  })

  // The summary is settled before the rest of the chain runs, in case the
  // turn_duration row is appended while the turn completes.
  on('turn.complete', async ($, e, next) => {
    if (current && !isSubagent(e)) {
      pending = await settle($, current)
      current = undefined
    }

    return next(e)
  })

  // The TurnDuration line's requestId is the uuid of this row. It may come
  // before turn.complete, so a turn still running is settled here too.
  on('session.append', async ($, e, next) => {
    const isDurationRow = e.message.type === 'system' && e.message.name === 'turn_duration' && e.agentId === undefined
    if (isDurationRow && (pending || current)) {
      const stats = pending ?? (await settle($, current!))
      pending = undefined
      current = undefined
      await update($, lines, record => keepNewest({ ...record, [e.uuid]: stats }, MAX_LINES))
      await $.store.set(STORE_KEY, await read($, lines))
    }

    return next(e)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const stats = (await read($, lines))[e.requestId]
    const line = await next(e)
    const text = stats ? summarize(stats, { topTools, isCostShown }) : undefined
    if (text === undefined) return line

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        {line}
        <Text dimColor> · {text}</Text>
      </Box>
    )
  })
}
