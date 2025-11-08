// API wrappers for Allowlist UI (Python) and PAC Service (Node)
// Supports multiple servers for Allowlist, and a single global config for PAC.

class BasicAuth {
  constructor(user, pass) {
    this.user = user || ''
    this.pass = pass || ''
  }
  header() {
    if (!this.user) return {}
    const token = btoa(`${this.user}:${this.pass}`)
    return { Authorization: `Basic ${token}` }
  }
}

async function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text()
}

export class AllowlistClient {
  constructor(baseUrl, auth) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.auth = auth // BasicAuth
  }
  health() {
    return httpRequest(`${this.baseUrl}/healthz`)
  }
  async list() {
    return httpRequest(`${this.baseUrl}/ips`, { headers: this.auth.header() })
  }
  async add(cidrOrIp) {
    return httpRequest(`${this.baseUrl}/ips`, {
      method: 'POST',
      headers: this.auth.header(),
      body: { cidr: cidrOrIp },
    })
  }
  async remove(cidrOrIp) {
    const encoded = encodeURIComponent(cidrOrIp)
    return httpRequest(`${this.baseUrl}/ips/${encoded}`, {
      method: 'DELETE',
      headers: this.auth.header(),
    })
  }
  async apply() {
    return httpRequest(`${this.baseUrl}/apply`, {
      method: 'POST',
      headers: this.auth.header(),
    })
  }
}

export class PacServiceClient {
  constructor(baseUrl, auth) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.auth = auth // BasicAuth or null (for /pac)
  }
  health() {
    return httpRequest(`${this.baseUrl}/health`)
  }
  pac() {
    return fetch(`${this.baseUrl}/pac`).then((r) => r.text())
  }
  listProxies() {
    return httpRequest(`${this.baseUrl}/proxies`, { headers: this.auth.header() })
  }
  getProxy(id) {
    return httpRequest(`${this.baseUrl}/proxies/${encodeURIComponent(id)}`, {
      headers: this.auth.header(),
    })
  }
  createProxy(proxy) {
    return httpRequest(`${this.baseUrl}/proxies`, {
      method: 'POST',
      headers: this.auth.header(),
      body: proxy,
    })
  }
  updateProxy(id, patch) {
    return httpRequest(`${this.baseUrl}/proxies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.auth.header(),
      body: patch,
    })
  }
  deleteProxy(id) {
    return httpRequest(`${this.baseUrl}/proxies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.auth.header(),
    })
  }
  addDomain(id, domain) {
    return httpRequest(`${this.baseUrl}/proxies/${encodeURIComponent(id)}/domains`, {
      method: 'POST',
      headers: this.auth.header(),
      body: domain,
    })
  }
  updateDomainTag(id, domainName, tag) {
    return httpRequest(
      `${this.baseUrl}/proxies/${encodeURIComponent(id)}/domains/${encodeURIComponent(domainName)}`,
      { method: 'PUT', headers: this.auth.header(), body: { tag } },
    )
  }
  removeDomain(id, domainName) {
    return httpRequest(
      `${this.baseUrl}/proxies/${encodeURIComponent(id)}/domains/${encodeURIComponent(domainName)}`,
      { method: 'DELETE', headers: this.auth.header() },
    )
  }
}

export class ServerRegistry {
  static async getAll() {
    const { servers } = await chrome.storage.local.get({ servers: [] })
    return servers
  }
  static async saveAll(servers) {
    await chrome.storage.local.set({ servers })
  }
  static async getActiveId() {
    const { activeServerId } = await chrome.storage.local.get({ activeServerId: null })
    return activeServerId
  }
  static async setActiveId(id) {
    await chrome.storage.local.set({ activeServerId: id })
  }
  static async getActive() {
    const [servers, activeId] = await Promise.all([this.getAll(), this.getActiveId()])
    return servers.find((s) => s.id === activeId) || servers[0] || null
  }
  static async ensureDefault() {
    const servers = await this.getAll()
    if (!servers.length) {
      const def = {
        id: 'local',
        name: 'Localhost',
        allowlistBase: 'http://localhost:8080',
        auth: { user: 'admin', pass: 'eufFThdD338' },
      }
      await this.saveAll([def])
      await this.setActiveId(def.id)
      return def
    }
    if (!(await this.getActiveId())) {
      await this.setActiveId(servers[0].id)
    }
    return this.getActive()
  }
}

// Global PAC config stored separately from servers
export class PacRegistry {
  static async getConfig() {
    const { pacConfig } = await chrome.storage.local.get({
      pacConfig: null,
    })
    return pacConfig
  }
  static async saveConfig(cfg) {
    await chrome.storage.local.set({ pacConfig: cfg })
  }
  static async ensureDefault() {
    let cfg = await this.getConfig()
    if (!cfg) {
      cfg = {
        base: 'http://localhost:3000',
        auth: { user: 'admin', pass: 'eufFThdD338' },
      }
      await this.saveConfig(cfg)
    }
    return cfg
  }
}

// Helper: build clients using active Allowlist server and global PAC config
export async function makeClientsGlobalPac(server) {
  const alAuth = new BasicAuth(server?.auth?.user, server?.auth?.pass)
  const pacCfg = await PacRegistry.ensureDefault()
  const pacAuth = new BasicAuth(pacCfg?.auth?.user, pacCfg?.auth?.pass)
  return {
    allowlist: new AllowlistClient(server.allowlistBase, alAuth),
    pac: new PacServiceClient(pacCfg.base, pacAuth),
  }
}
