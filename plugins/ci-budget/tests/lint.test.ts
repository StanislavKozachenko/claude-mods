import { describe, expect, test } from 'claude-code/testing'

import { cronRunsPerDay, isWorkflowPath, lintWorkflow, matrixSize } from '../hooks/lint'

const CAREFUL = `name: CI
on:
  push:
    branches: [main]
  pull_request:
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
`

const CARELESS = `name: Build
on: [push, pull_request]
jobs:
  build:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node:
          - 18
          - 20
          - 22
    steps:
      - run: npm test
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
`

describe('lintWorkflow', () => {
  test('a careful workflow has nothing to say', async () => {
    expect(lintWorkflow(CAREFUL)).toEqual([])
  })

  test('a careless one: timeouts, matrix, runners, cancellation, duplicate runs', async () => {
    const warnings = lintWorkflow(CARELESS, { isPrivate: true })
    expect(warnings.some(w => w.startsWith('2 of 2 jobs have no timeout-minutes'))).toBe(true)
    expect(warnings.some(w => w.includes('expands to 9 jobs'))).toBe(true)
    expect(warnings.some(w => w.startsWith('macOS runners cost 10'))).toBe(true)
    expect(warnings.some(w => w.startsWith('Windows runners cost 2'))).toBe(true)
    expect(warnings.some(w => w.startsWith('Pull request runs are not cancelled'))).toBe(true)
    expect(warnings.some(w => w.includes('runs it twice'))).toBe(true)
  })

  test('runner costs are not raised for a public repo', async () => {
    expect(lintWorkflow(CARELESS, { isPrivate: false }).some(w => w.includes('runners cost'))).toBe(false)
  })

  test('frequent schedules and self-triggering workflow_run', async () => {
    const scheduled = `name: Poll\non:\n  schedule:\n    - cron: '*/5 * * * *'\njobs:\n  poll:\n    runs-on: ubuntu-latest\n    timeout-minutes: 2\n`
    expect(lintWorkflow(scheduled)).toEqual(['The schedule "*/5 * * * *" runs 288 times a day, about 8640 runs a month.'])

    const looping = `name: Deploy\non:\n  workflow_run:\n    workflows: [Deploy]\n    types: [completed]\njobs:\n  go:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n`
    expect(lintWorkflow(looping)).toEqual(['It triggers on workflow_run of "Deploy", its own name: every run starts another one.'])
  })
})

describe('helpers', () => {
  test('cronRunsPerDay', async () => {
    expect(cronRunsPerDay('0 3 * * *')).toBe(1)
    expect(cronRunsPerDay('0 * * * *')).toBe(24)
    expect(cronRunsPerDay('*/15 9-17 * * 1-5')).toBe(36)
    expect(cronRunsPerDay('0,30 */2 * * *')).toBe(24)
  })

  test('matrixSize and isWorkflowPath', async () => {
    expect(matrixSize(CARELESS)).toBe(9)
    expect(matrixSize(CAREFUL)).toBe(1)
    expect(isWorkflowPath('/repo/.github/workflows/ci.yml')).toBe(true)
    expect(isWorkflowPath('C:\\repo\\.github\\workflows\\release.yaml')).toBe(true)
    expect(isWorkflowPath('/repo/.github/dependabot.yml')).toBe(false)
  })
})
