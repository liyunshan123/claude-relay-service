function createEntry(defaultModel = null) {
  return defaultModel ? { model: defaultModel } : {}
}

function hasNumericUsageValue(entry) {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  return (
    entry.input_tokens !== undefined ||
    entry.output_tokens !== undefined ||
    entry.cache_creation_input_tokens !== undefined ||
    entry.cache_read_input_tokens !== undefined
  )
}

function hasDetailedCacheCreation(entry) {
  if (!entry || typeof entry !== 'object' || !entry.cache_creation) {
    return false
  }

  return (
    entry.cache_creation.ephemeral_5m_input_tokens !== undefined ||
    entry.cache_creation.ephemeral_1h_input_tokens !== undefined
  )
}

function hasUsageData(entry) {
  return hasNumericUsageValue(entry) || hasDetailedCacheCreation(entry)
}

function cloneEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return {}
  }

  const cloned = { ...entry }
  if (entry.cache_creation && typeof entry.cache_creation === 'object') {
    cloned.cache_creation = { ...entry.cache_creation }
  }
  return cloned
}

function mergeDetailedCacheCreation(target, cacheCreation) {
  if (!cacheCreation || typeof cacheCreation !== 'object') {
    return
  }

  const nextCacheCreation =
    target.cache_creation && typeof target.cache_creation === 'object'
      ? { ...target.cache_creation }
      : {}

  if (cacheCreation.ephemeral_5m_input_tokens !== undefined) {
    nextCacheCreation.ephemeral_5m_input_tokens = cacheCreation.ephemeral_5m_input_tokens || 0
  }

  if (cacheCreation.ephemeral_1h_input_tokens !== undefined) {
    nextCacheCreation.ephemeral_1h_input_tokens = cacheCreation.ephemeral_1h_input_tokens || 0
  }

  if (Object.keys(nextCacheCreation).length > 0) {
    target.cache_creation = nextCacheCreation
  }
}

function mergeUsageSnapshot(target, usage, model = null) {
  if (!target || typeof target !== 'object' || !usage || typeof usage !== 'object') {
    return target
  }

  if (model !== undefined && model !== null && model !== '') {
    target.model = model
  }

  if (usage.input_tokens !== undefined) {
    target.input_tokens = usage.input_tokens || 0
  }

  if (usage.output_tokens !== undefined) {
    target.output_tokens = usage.output_tokens || 0
  }

  if (usage.cache_creation_input_tokens !== undefined) {
    target.cache_creation_input_tokens = usage.cache_creation_input_tokens || 0
  }

  if (usage.cache_read_input_tokens !== undefined) {
    target.cache_read_input_tokens = usage.cache_read_input_tokens || 0
  }

  mergeDetailedCacheCreation(target, usage.cache_creation)

  return target
}

function createAnthropicUsageCollector(defaultModel = null) {
  return {
    defaultModel: defaultModel || null,
    current: createEntry(defaultModel),
    entries: []
  }
}

function resetCollectorCurrent(collector) {
  collector.current = createEntry(collector.defaultModel)
}

function finalizeAnthropicUsageCollector(
  collector,
  logger = null,
  label = 'Anthropic',
  reason = 'stream_end'
) {
  if (!collector || !hasUsageData(collector.current)) {
    return false
  }

  if (collector.current.output_tokens === undefined) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(
        `⚠️ [${label}] Incomplete usage data before ${reason}, skipping usage record: ${JSON.stringify(collector.current)}`
      )
    }
    resetCollectorCurrent(collector)
    return false
  }

  collector.entries.push(cloneEntry(collector.current))
  resetCollectorCurrent(collector)
  return true
}

function consumeAnthropicUsageEvent(collector, data, logger = null, label = 'Anthropic') {
  if (!collector || !data || typeof data !== 'object') {
    return
  }

  if (data.type === 'message_start' && data.message && data.message.usage) {
    if (hasUsageData(collector.current)) {
      finalizeAnthropicUsageCollector(collector, logger, label, 'message_start')
    }

    mergeUsageSnapshot(
      collector.current,
      data.message.usage,
      data.message.model || collector.current.model || collector.defaultModel
    )
    return
  }

  if (data.type === 'message_delta') {
    const usage = data.usage || data.delta?.usage
    if (usage && typeof usage === 'object') {
      mergeUsageSnapshot(collector.current, usage)
    }
    return
  }

  if (data.type === 'message_stop') {
    finalizeAnthropicUsageCollector(collector, logger, label, 'message_stop')
  }
}

function parseAnthropicSseLine(line) {
  if (typeof line !== 'string' || !line.startsWith('data:')) {
    return null
  }

  const jsonStr = line.slice(5).trimStart()
  if (!jsonStr || jsonStr === '[DONE]') {
    return null
  }

  return JSON.parse(jsonStr)
}

function consumeAnthropicSseLine(collector, line, logger = null, label = 'Anthropic') {
  const data = parseAnthropicSseLine(line)
  if (data) {
    consumeAnthropicUsageEvent(collector, data, logger, label)
  }
  return data
}

function summarizeAnthropicUsageCollector(collector, fallbackModel = 'unknown') {
  if (!collector || !Array.isArray(collector.entries) || collector.entries.length === 0) {
    return null
  }

  const summary = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    model: collector.entries[collector.entries.length - 1].model || fallbackModel
  }

  let totalEphemeral5m = 0
  let totalEphemeral1h = 0

  for (const entry of collector.entries) {
    summary.input_tokens += entry.input_tokens || 0
    summary.output_tokens += entry.output_tokens || 0
    summary.cache_creation_input_tokens += entry.cache_creation_input_tokens || 0
    summary.cache_read_input_tokens += entry.cache_read_input_tokens || 0

    if (entry.cache_creation && typeof entry.cache_creation === 'object') {
      totalEphemeral5m += entry.cache_creation.ephemeral_5m_input_tokens || 0
      totalEphemeral1h += entry.cache_creation.ephemeral_1h_input_tokens || 0
    }
  }

  if (totalEphemeral5m > 0 || totalEphemeral1h > 0) {
    summary.cache_creation = {
      ephemeral_5m_input_tokens: totalEphemeral5m,
      ephemeral_1h_input_tokens: totalEphemeral1h
    }
  }

  return summary
}

module.exports = {
  createAnthropicUsageCollector,
  consumeAnthropicSseLine,
  finalizeAnthropicUsageCollector,
  summarizeAnthropicUsageCollector
}
