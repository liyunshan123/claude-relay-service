const {
  createAnthropicUsageCollector,
  consumeAnthropicSseLine,
  finalizeAnthropicUsageCollector,
  summarizeAnthropicUsageCollector
} = require('../src/utils/anthropicUsageCollector')

function toSseLine(payload) {
  return `data: ${JSON.stringify(payload)}`
}

describe('anthropicUsageCollector', () => {
  it('captures output tokens when the final message_delta is only processed at stream end', () => {
    const collector = createAnthropicUsageCollector('claude-opus-4-6')

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_start',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 120,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5
          }
        }
      })
    )

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_delta',
        usage: {
          output_tokens: 88
        }
      })
    )

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_stop'
      })
    )

    finalizeAnthropicUsageCollector(collector)
    const summary = summarizeAnthropicUsageCollector(collector, 'claude-opus-4-6')

    expect(summary).toEqual({
      input_tokens: 120,
      output_tokens: 88,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
      model: 'claude-opus-4-6'
    })
  })

  it('uses the latest output_tokens value when multiple message_delta events are received', () => {
    const collector = createAnthropicUsageCollector('claude-opus-4-6')

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_start',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 50
          }
        }
      })
    )

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_delta',
        usage: {
          output_tokens: 12
        }
      })
    )

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_delta',
        usage: {
          output_tokens: 34
        }
      })
    )

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_stop'
      })
    )

    const summary = summarizeAnthropicUsageCollector(collector, 'claude-opus-4-6')

    expect(summary).toEqual({
      input_tokens: 50,
      output_tokens: 34,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      model: 'claude-opus-4-6'
    })
  })

  it('does not create a usage record when output_tokens was never captured', () => {
    const collector = createAnthropicUsageCollector('claude-opus-4-6')

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_start',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 99
          }
        }
      })
    )

    consumeAnthropicSseLine(
      collector,
      toSseLine({
        type: 'message_stop'
      })
    )

    finalizeAnthropicUsageCollector(collector)

    expect(summarizeAnthropicUsageCollector(collector, 'claude-opus-4-6')).toBeNull()
  })
})
