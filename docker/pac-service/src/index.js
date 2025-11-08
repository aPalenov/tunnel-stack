import express from 'express'
import morgan from 'morgan'
import cors from 'cors'
import { nanoid } from 'nanoid'
import {
  listProxies,
  getProxy,
  addProxy,
  updateProxy,
  deleteProxy,
  addDomain,
  removeDomain,
  generatePac,
  getState,
  updateDomainTag,
} from './store.js'

const app = express()
app.use(cors())
app.use(express.json())
app.use(morgan('dev'))

// Basic Auth middleware (optional if env vars missing)
const AUTH_USER = process.env.BASIC_AUTH_USER || null
const AUTH_PASS = process.env.BASIC_AUTH_PASS || null

function basicAuth(req, res, next) {
  // Always allow health and PAC for monitoring/clients
  if (['/health', '/pac'].includes(req.path)) return next()
  // If auth not configured, allow all
  if (!AUTH_USER || !AUTH_PASS) return next()
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="PAC Service"')
    return res.status(401).json({ error: 'auth_required' })
  }
  try {
    const base64 = header.slice(6)
    const decoded = Buffer.from(base64, 'base64').toString('utf8')
    const [user, pass] = decoded.split(':')
    if (user === AUTH_USER && pass === AUTH_PASS) return next()
  } catch (e) {
    // fallthrough to unauthorized
  }
  res.set('WWW-Authenticate', 'Basic realm="PAC Service"')
  return res.status(401).json({ error: 'invalid_credentials' })
}

app.use(basicAuth)

function validateProxyInput(body, partial = false) {
  const errors = []
  if (!partial || body.id !== undefined) {
    if (typeof body.id !== 'string' || body.id.trim() === '')
      errors.push('id must be non-empty string')
  }
  if (!partial || body.proto !== undefined) {
    if (!['SOCKS', 'SOCKS5', 'PROXY'].includes(body.proto))
      errors.push('proto must be SOCKS or SOCKS5 or PROXY')
  }
  if (!partial || body.host !== undefined) {
    if (typeof body.host !== 'string' || body.host.trim() === '')
      errors.push('host must be non-empty string')
  }
  if (!partial || body.port !== undefined) {
    if (typeof body.port !== 'number' || body.port <= 0) errors.push('port must be positive number')
  }
  if (body.domains !== undefined) {
    if (
      !Array.isArray(body.domains) ||
      body.domains.some((d) => !d || typeof d.name !== 'string' || !d.name.trim())
    ) {
      errors.push('domains must be array of objects {name, tag?}')
    }
  }
  return errors
}

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// Get full state (debug)
app.get('/state', async (req, res) => {
  res.json(await getState())
})

// List proxies
app.get('/proxies', async (req, res) => {
  res.json(await listProxies())
})

// Get proxy by id
app.get('/proxies/:id', async (req, res) => {
  const proxy = await getProxy(req.params.id)
  if (!proxy) return res.status(404).json({ error: 'not_found' })
  res.json(proxy)
})

// Create proxy
app.post('/proxies', async (req, res) => {
  const body = req.body
  if (!body.id) body.id = nanoid(8)
  const errors = validateProxyInput(body)
  if (errors.length) return res.status(400).json({ errors })
  try {
    const created = await addProxy({
      id: body.id,
      proto: body.proto,
      host: body.host,
      port: body.port,
      domains: body.domains || [],
    })
    res.status(201).json(created)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// Update proxy
app.put('/proxies/:id', async (req, res) => {
  const errors = validateProxyInput(req.body, true)
  if (errors.length) return res.status(400).json({ errors })
  try {
    const updated = await updateProxy(req.params.id, req.body)
    res.json(updated)
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// Delete proxy
app.delete('/proxies/:id', async (req, res) => {
  try {
    await deleteProxy(req.params.id)
    res.status(204).end()
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// Add domain to proxy
app.post('/proxies/:id/domains', async (req, res) => {
  const { name, tag } = req.body
  if (typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'name required' })
  try {
    const added = await addDomain(req.params.id, { name: name.trim(), tag })
    res.status(201).json({ domain: added })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// Remove domain from proxy
app.delete('/proxies/:id/domains/:domain', async (req, res) => {
  try {
    await removeDomain(req.params.id, req.params.domain)
    res.status(204).end()
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

// Update domain tag
app.put('/proxies/:id/domains/:domain', async (req, res) => {
  const { tag } = req.body || {}
  try {
    const updated = await updateDomainTag(req.params.id, req.params.domain, tag)
    res.json({ domain: updated })
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 400
    res.status(code).json({ error: e.message })
  }
})

// PAC endpoint
app.get('/pac', async (req, res) => {
  try {
    const pac = await generatePac()
    res.set('Content-Type', 'application/x-ns-proxy-autoconfig')
    res.send(pac)
  } catch (e) {
    res.status(500).json({ error: 'pac_generation_failed', detail: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`PAC service listening on port ${PORT}`)
})
