import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextSnapshot } from '../types'
import { GLYPH, allocate, legend, summary } from './layout'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)

/** The person's /context-bar choice, kept across sessions. */
const HIDDEN_KEY = 'isHidden'

/** From this share of the window the summary is drawn bold. */
const HIGH_PERCENT = 80

/** Cells kept free at the right end, so the row never reaches the band edge and wraps. */
const MARGIN = 2

/** Below this many cells for the bar, the band shows the summary alone. */
const MIN_BAR = 10

let measuredAt = 0

// The summary breakdown is estimated locally, the same rows /context lists,
// without a token-count request.
async function measure($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  if (!breakdown) return

  measuredAt = await $.clock.now()
  const next: ContextSnapshot = {
    categories: breakdown.categories.map(({ name, tokens, color, kind }) => ({ name, tokens, color, kind })),
    usedTokens: breakdown.totalTokens,
    maxTokens: breakdown.rawMaxTokens,
    percent: breakdown.percentage,
    at: measuredAt,
  }
  await update($, snapshot, () => next)
}

async function measureIfStale($: EngineInterface, refreshMs: number) {
  if ((await $.clock.now()) - measuredAt >= refreshMs) await measure($)
}

export const register: Register = (on, options) => {
  const isLegendShown = options.legend !== false
  const refreshMs = Math.max(1, Number(options.refreshSeconds ?? 5)) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Show or hide the context window bar above the prompt',
      argumentHint: '[on|off]',
    })
    const stored = await $.store.get(HIDDEN_KEY)
    if (stored === true) await update($, isHidden, () => true)

    const started = await next(e)
    await measure($)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await measure($)

    return done
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await measure($)

    return compacted
  })

  // Tool results are what grows a long turn: re-measure after them, at most
  // once per refreshSeconds.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await measureIfStale($, refreshMs)

    return ran
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const wasHidden = await read($, isHidden)
    const hide = arg === 'off' ? true : arg === 'on' ? false : arg === '' ? !wasHidden : undefined
    if (hide === undefined) return { text: 'Usage: /context-bar [on|off]' }

    await update($, isHidden, () => hide)
    await $.store.set(HIDDEN_KEY, hide)
    if (!hide) await measure($)

    return { text: hide ? 'Hidden. /context-bar shows it again.' : 'Shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The breakdown is the main conversation's: not over a subagent's transcript
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    if (await read($, isHidden)) return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const label = summary(snap)
    const isHigh = snap.percent >= HIGH_PERCENT
    const barWidth = width - label.length - 1 - MARGIN

    if (barWidth < MIN_BAR) {
      return (
        <Box>
          <Text dimColor={!isHigh} bold={isHigh}>
            context {label}
          </Text>
        </Box>
      )
    }

    const items = isLegendShown ? legend(snap, width) : []

    return (
      <Box flexDirection="column">
        {/* The summary leads, so a squeezed row cuts the end of the bar, never the numbers */}
        <Box>
          <Text dimColor={!isHigh} bold={isHigh}>
            {label}{' '}
          </Text>
          {allocate(snap, barWidth).map(segment => (
            <Text color={segment.color} dimColor={segment.kind !== 'used'}>
              {GLYPH[segment.kind].repeat(segment.cells)}
            </Text>
          ))}
        </Box>
        {items.length > 0 && (
          <Box>
            {items.flatMap((item, i) => [
              ...(i > 0 ? [<Text>{'  '}</Text>] : []),
              ...(item.name === '' ? [] : [<Text color={item.color}>■ </Text>]),
              <Text dimColor>{item.label}</Text>,
            ])}
          </Box>
        )}
      </Box>
    )
  })
}
