import { readFile, writeFile, unlink, copyFile } from 'fs/promises'
import { renameSync } from 'fs'
import path from 'path'

const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), 'data', 'db.json')

let cache = null
let writeLock = Promise.resolve()

async function load() {
  if (cache) return cache
  try {
    const raw = await readFile(DB_FILE, 'utf8')
    cache = JSON.parse(raw)
  } catch (e) {
    cache = { proxies: [] }
  }
  // Normalize domains to objects: { name, tag? }
  if (!cache.proxies) cache.proxies = []
  cache.proxies = cache.proxies.map((p) => {
    const domains = Array.isArray(p.domains) ? p.domains : []
    const norm = domains
      .map((d) =>
        d && typeof d === 'object' && typeof d.name === 'string'
          ? { name: d.name, tag: d.tag }
          : null,
      )
      .filter(Boolean)
    return { ...p, domains: norm }
  })
  return cache
}

function queueWrite(task) {
  // Run the task after the current lock. Keep the global queue alive even if the task fails,
  // but let the caller observe the error (so API can return a failure and rollback can occur).
  const run = writeLock.then(() => task())
  writeLock = run.catch((err) => {
    console.error('DB write error:', err)
    // Swallow here to keep the queue from getting stuck in rejected state
  })
  return run // This promise may reject; callers must handle it
}

async function save() {
  const tmpFile = DB_FILE + '.tmp'
  await writeFile(tmpFile, JSON.stringify(cache, null, 2), 'utf8')
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(tmpFile, DB_FILE) // atomic-ish replace
      return
    } catch (e) {
      const code = e && e.code
      const isRetryable = code === 'EBUSY' || code === 'EPERM'
      const isCrossDevice = code === 'EXDEV'
      if (isCrossDevice || !isRetryable || attempt === maxAttempts) {
        // If rename fails due to cross-device (e.g., bind-mounted single file),
        // or as a last resort after retries, copy over the destination.
        if (isCrossDevice || isRetryable) {
          try {
            await copyFile(tmpFile, DB_FILE)
            try {
              await unlink(tmpFile)
            } catch {}
            return
          } catch {}
        }
        // Best-effort cleanup of temp file
        try {
          await unlink(tmpFile)
        } catch {}
        throw e
      }
      // Small backoff before retrying
      await new Promise((r) => setTimeout(r, 50 * attempt))
    }
  }
}

// Helper: perform a mutation and persist atomically in the write queue.
// Rolls back in-memory cache if persistence fails.
async function commitMutation(mutator) {
  await load()
  return queueWrite(async () => {
    const snapshot = JSON.parse(JSON.stringify(cache))
    try {
      const result = await mutator()
      await save()
      return result
    } catch (err) {
      // Rollback on failure
      cache = snapshot
      throw err
    }
  })
}

export async function getState() {
  const state = await load()
  return JSON.parse(JSON.stringify(state)) // deep clone
}

export async function listProxies() {
  const { proxies } = await load()
  return proxies.map((p) => ({ ...p }))
}

export async function getProxy(id) {
  const { proxies } = await load()
  return proxies.find((p) => p.id === id) || null
}

export async function addProxy(proxy) {
  return commitMutation(() => {
    if (cache.proxies.some((p) => p.id === proxy.id)) throw new Error('Proxy id already exists')
    // Expect domains as array of objects { name, tag? }
    const domains = Array.isArray(proxy.domains)
      ? proxy.domains.map((d) => {
          if (!d || typeof d.name !== 'string' || !d.name.trim())
            throw new Error('Invalid domain entry')
          return { name: d.name.trim(), tag: d.tag }
        })
      : []
    cache.proxies.push({ ...proxy, domains })
    return proxy
  })
}

export async function updateProxy(id, patch) {
  return commitMutation(() => {
    const idx = cache.proxies.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error('Proxy not found')
    cache.proxies[idx] = { ...cache.proxies[idx], ...patch }
    return { ...cache.proxies[idx] }
  })
}

export async function deleteProxy(id) {
  return commitMutation(() => {
    const before = cache.proxies.length
    cache.proxies = cache.proxies.filter((p) => p.id !== id)
    if (cache.proxies.length === before) throw new Error('Proxy not found')
    return true
  })
}

export async function addDomain(id, domain) {
  return commitMutation(() => {
    const proxy = cache.proxies.find((p) => p.id === id)
    if (!proxy) throw new Error('Proxy not found')
    if (!domain || typeof domain.name !== 'string' || !domain.name.trim())
      throw new Error('domain object with name required')
    const entry = { name: domain.name.trim(), tag: domain.tag }
    if (!proxy.domains.some((d) => d.name === entry.name)) proxy.domains.push(entry)
    return entry
  })
}

export async function removeDomain(id, domain) {
  return commitMutation(() => {
    const proxy = cache.proxies.find((p) => p.id === id)
    if (!proxy) throw new Error('Proxy not found')
    const name = typeof domain === 'string' ? domain : domain.name
    proxy.domains = proxy.domains.filter((d) => d.name !== name)
    return true
  })
}

export async function updateDomainTag(id, domainName, tag) {
  return commitMutation(() => {
    const proxy = cache.proxies.find((p) => p.id === id)
    if (!proxy) throw new Error('Proxy not found')
    const d = proxy.domains.find((d) => d.name === domainName)
    if (!d) throw new Error('Domain not found')
    d.tag = tag
    return { ...d }
  })
}

export async function generatePac() {
  await load()
  const entries = cache.proxies.map((p) => {
    const proxyStr = `${p.proto} ${p.host}:${p.port}`
    return { proxyStr, domains: p.domains }
  })
  const lines = []
  lines.push('function FindProxyForURL(url, host) {')
  lines.push('  var proxies = {')
  entries.forEach((e, idx) => {
    lines.push(`    "${e.proxyStr}": [`)
    e.domains.forEach((d, dIdx) => {
      const name = d.name
      const tag = d.tag
      const comma = dIdx < e.domains.length - 1 ? ',' : ''
      const safeTag = tag ? String(tag).replaceAll('*/', '*\\/') : ''
      const comment = tag ? ` // ${safeTag}` : ''
      lines.push(`      "${name}"${comma}${comment}`)
    })
    const comma = idx < entries.length - 1 ? ',' : ''
    lines.push(`    ]${comma}`)
  })
  lines.push('  };')
  lines.push('  for (var proxy in proxies) {')
  lines.push('    for (var i = 0; i < proxies[proxy].length; i++) {')
  lines.push('      var domain = proxies[proxy][i];')
  lines.push('      if (dnsDomainIs(host, domain)) {')
  lines.push('        return proxy;')
  lines.push('      }')
  lines.push('    }')
  lines.push('  }')
  lines.push('  return "DIRECT";')
  lines.push('}')
  return lines.join('\n')
}
