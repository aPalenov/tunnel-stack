import { ServerRegistry, PacRegistry, makeClientsGlobalPac } from './api.js'

const serverSelect = document.getElementById('serverSelect')
const healthStatus = document.getElementById('healthStatus')
const allowlistTableBody = document.querySelector('#allowlistTable tbody')
const addIpForm = document.getElementById('addIpForm')
const ipInput = document.getElementById('ipInput')
const allowlistMsg = document.getElementById('allowlistMsg')
const applyBtn = document.getElementById('applyBtn')
const reloadPacBtn = document.getElementById('reloadPac')
const pacContent = document.getElementById('pacContent')
const proxyMsg = document.getElementById('proxyMsg')
const createProxyForm = document.getElementById('createProxyForm')
const proxiesTableBody = document.querySelector('#proxiesTable tbody')
const refreshAllBtn = document.getElementById('refreshAllBtn')
// Native host UI elements
const pacUrlInput = document.getElementById('pacUrlInput')
const btnSetPac = document.getElementById('btnSetPac')
const btnSetPacForce = document.getElementById('btnSetPacForce')
const nativeMsg = document.getElementById('nativeMsg')
let platform = { os: 'unknown' }
let nativeUsable = false

const tabs = document.querySelectorAll('.tabs button')
const sections = document.querySelectorAll('.section')

tabs.forEach((btn) =>
  btn.addEventListener('click', () => {
    tabs.forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    sections.forEach((s) => s.classList.toggle('active', s.id === btn.dataset.tab))
  }),
)

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

let clients = null

async function initServers() {
  const servers = await ServerRegistry.getAll()
  const activeId = await ServerRegistry.getActiveId()
  serverSelect.innerHTML = servers
    .map((s) => `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>${s.name}</option>`)
    .join('')
  serverSelect.onchange = async () => {
    await ServerRegistry.setActiveId(serverSelect.value)
    await refreshAll()
  }
  const active = await ServerRegistry.ensureDefault()
  clients = await makeClientsGlobalPac(active)
}

async function refreshHealth() {
  healthStatus.textContent = 'Checking…'
  try {
    const [allowlistHealth, pacHealth] = await Promise.all([
      clients.allowlist.health().catch((e) => ({ error: e.message })),
      clients.pac.health().catch((e) => ({ error: e.message })),
    ])
    healthStatus.textContent = `AL:${allowlistHealth.status || 'ERR'} PAC:${
      pacHealth.status || 'ERR'
    }`
    healthStatus.title = `Allowlist: ${JSON.stringify(allowlistHealth)}\nPAC: ${JSON.stringify(
      pacHealth,
    )}`
  } catch (e) {
    healthStatus.textContent = 'Health ERR'
  }
}

// Restore missing allowlist loader (was removed by previous refactor)
async function loadAllowlist() {
  allowlistMsg.textContent = 'Loading…'
  allowlistTableBody.innerHTML = ''
  try {
    const data = await clients.allowlist.list()
    allowlistMsg.textContent = `${data.items.length} items`
    data.items.forEach((item) => {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${item}</td><td><button class='danger'>Del</button></td>`
      tr.querySelector('button').onclick = async () => {
        try {
          await clients.allowlist.remove(item)
          await loadAllowlist()
        } catch (e) {
          allowlistMsg.textContent = e.message
        }
      }
      allowlistTableBody.appendChild(tr)
    })
  } catch (e) {
    allowlistMsg.textContent = e.message
  }
}

addIpForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const value = ipInput.value.trim()
  if (!value) return
  allowlistMsg.textContent = 'Adding…'
  try {
    await clients.allowlist.add(value)
    ipInput.value = ''
    await loadAllowlist()
    allowlistMsg.textContent = 'Added.'
  } catch (err) {
    allowlistMsg.textContent = err.message
  }
})

applyBtn.addEventListener('click', async () => {
  applyBtn.disabled = true
  allowlistMsg.textContent = 'Applying…'
  try {
    await clients.allowlist.apply()
    allowlistMsg.textContent = 'Applied (container restart triggered).'
  } catch (e) {
    allowlistMsg.textContent = e.message
  } finally {
    applyBtn.disabled = false
  }
})

async function loadProxies() {
  proxyMsg.textContent = 'Loading…'
  proxiesTableBody.innerHTML = ''
  try {
    const list = await clients.pac.listProxies()
    proxyMsg.textContent = `${list.length} proxies`
    list.forEach((p) => {
      // Main proxy row
      const tr = document.createElement('tr')
      const tdId = document.createElement('td')
      tdId.textContent = p.id
      const tdProto = document.createElement('td')
      tdProto.textContent = p.proto
      const tdHost = document.createElement('td')
      tdHost.textContent = p.host
      const tdPort = document.createElement('td')
      tdPort.textContent = String(p.port)
      const tdDomains = document.createElement('td')
      tdDomains.className = 'domains'
      ;(p.domains || []).forEach((d) => {
        const wrap = document.createElement('span')
        const tagEl = document.createElement('span')
        tagEl.className = 'tag'
        tagEl.textContent = d.name
        tagEl.title = d.tag || ''
        const editBtn = document.createElement('button')
        editBtn.className = 'secondary btn-xxs'
        editBtn.title = 'Edit tag'
        editBtn.textContent = '✏'
        editBtn.onclick = async () => {
          const value = prompt(`Set tag for ${d.name} (empty = remove)`, d.tag || '')
          if (value === null) return
          try {
            const newTag = value.trim()
            await clients.pac.updateDomainTag(p.id, d.name, newTag ? newTag : null)
            await loadProxies()
            await applyForcePacSilently()
          } catch (e) {
            proxyMsg.textContent = e.message
          }
        }
        const delBtn = document.createElement('button')
        delBtn.className = 'danger btn-xxs'
        delBtn.title = 'Delete domain'
        delBtn.textContent = '×'
        delBtn.onclick = async () => {
          if (!confirm(`Remove domain ${d.name}?`)) return
          try {
            await clients.pac.removeDomain(p.id, d.name)
            await loadProxies()
            await applyForcePacSilently()
          } catch (e) {
            proxyMsg.textContent = e.message
          }
        }
        wrap.appendChild(tagEl)
        wrap.appendChild(editBtn)
        wrap.appendChild(delBtn)
        tdDomains.appendChild(wrap)
      })
      const tdActions = document.createElement('td')
      const delProxyBtn = document.createElement('button')
      delProxyBtn.className = 'danger'
      delProxyBtn.textContent = 'Del'
      delProxyBtn.onclick = async () => {
        try {
          await clients.pac.deleteProxy(p.id)
          await loadProxies()
        } catch (e) {
          proxyMsg.textContent = e.message
        }
      }
      const editProxyBtn = document.createElement('button')
      editProxyBtn.className = 'secondary'
      editProxyBtn.style.marginLeft = '6px'
      editProxyBtn.textContent = 'Edit'
      tdActions.appendChild(delProxyBtn)
      tdActions.appendChild(editProxyBtn)

      tr.appendChild(tdId)
      tr.appendChild(tdProto)
      tr.appendChild(tdHost)
      tr.appendChild(tdPort)
      tr.appendChild(tdDomains)
      tr.appendChild(tdActions)
      proxiesTableBody.appendChild(tr)

      // Domain add form row
      const tr2 = document.createElement('tr')
      tr2.innerHTML = `<td colspan='6'>
        <form class='inline domainForm'>
          <input type='text' name='domain' placeholder='Add domain' required />
          <input type='text' name='tag' placeholder='Tag (optional)' />
          <button type='submit'>Add Domain</button>
        </form>
      </td>`
      const form = tr2.querySelector('form')
      form.onsubmit = async (e) => {
        e.preventDefault()
        const domain = form.domain.value.trim()
        const tag = form.tag.value.trim()
        if (!domain) return
        try {
          await clients.pac.addDomain(p.id, { name: domain, tag: tag || undefined })
          form.domain.value = ''
          form.tag.value = ''
          await loadProxies()
          await applyForcePacSilently()
        } catch (err) {
          proxyMsg.textContent = err.message
        }
      }
      proxiesTableBody.appendChild(tr2)

      // Proxy edit row (toggle)
      const tr3 = document.createElement('tr')
      tr3.style.display = 'none'
      tr3.innerHTML = `<td colspan='6'>
        <form class='inline editProxyForm'>
          <input type='text' name='proto' value='${p.proto}' placeholder='SOCKS/PROXY' required />
          <input type='text' name='host' value='${p.host}' placeholder='Host' required />
          <input type='number' name='port' value='${p.port}' placeholder='Port' required />
          <button type='submit'>Save</button>
          <button type='button' data-act='cancel' class='secondary'>Cancel</button>
        </form>
      </td>`
      const editForm = tr3.querySelector('form')
      editForm.onsubmit = async (e) => {
        e.preventDefault()
        const fd = new FormData(editForm)
        const obj = Object.fromEntries(fd.entries())
        const patch = { proto: obj.proto.trim(), host: obj.host.trim(), port: Number(obj.port) }
        try {
          await clients.pac.updateProxy(p.id, patch)
          await loadProxies()
        } catch (e2) {
          proxyMsg.textContent = e2.message
        }
      }
      tr3.querySelector('[data-act=cancel]').onclick = () => {
        tr3.style.display = 'none'
      }
      editProxyBtn.onclick = () => {
        tr3.style.display = tr3.style.display === 'none' ? '' : 'none'
      }
      proxiesTableBody.appendChild(tr3)
    })
  } catch (e) {
    proxyMsg.textContent = e.message
  }
}

createProxyForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const formData = new FormData(createProxyForm)
  const obj = Object.fromEntries(formData.entries())
  obj.port = Number(obj.port)
  proxyMsg.textContent = 'Creating…'
  try {
    await clients.pac.createProxy(obj)
    createProxyForm.reset()
    await loadProxies()
    proxyMsg.textContent = 'Created.'
  } catch (err) {
    proxyMsg.textContent = err.message
  }
})

reloadPacBtn.addEventListener('click', loadPac)
refreshAllBtn.addEventListener('click', async () => {
  const prev = refreshAllBtn.textContent
  refreshAllBtn.disabled = true
  refreshAllBtn.textContent = 'Refreshing…'
  try {
    await refreshAll()
  } finally {
    refreshAllBtn.disabled = false
    refreshAllBtn.textContent = prev || 'Refresh'
  }
})

async function loadPac() {
  pacContent.textContent = 'Loading PAC…'
  try {
    pacContent.textContent = await clients.pac.pac()
  } catch (e) {
    pacContent.textContent = e.message
  }
}

async function refreshAll() {
  const active = await ServerRegistry.getActive()
  clients = await makeClientsGlobalPac(active)
  await updatePacUrlInputFromConfig()
  await Promise.all([refreshHealth(), loadAllowlist(), loadProxies(), loadPac()])
}

;(async function init() {
  try {
    platform = await chrome.runtime.getPlatformInfo()
  } catch {}
  await initServers()
  await refreshAll()
  await checkNativeHost()
})()

// --- Native Messaging: Set PAC URL in Windows registry ---
function buildPacUrl(base, force = false) {
  if (!base) return ''
  const clean = base.replace(/\/$/, '')
  return `${clean}/pac${force ? '?force=1' : ''}`
}

async function updatePacUrlInputFromConfig() {
  const cfg = await PacRegistry.ensureDefault()
  const url = buildPacUrl(cfg?.base, false)
  pacUrlInput.value = url || ''
}

async function checkNativeHost() {
  // Hide/disable controls if not Windows
  if (platform?.os !== 'win') {
    if (nativeMsg) nativeMsg.textContent = 'Windows only'
    btnSetPac?.setAttribute('disabled', 'true')
    btnSetPacForce?.setAttribute('disabled', 'true')
    return
  }
  try {
    const resp = await chrome.runtime.sendNativeMessage('com.tunnelstack.pacsetter', {
      cmd: 'ping',
    })
    nativeUsable = !!(resp && resp.ok)
    nativeMsg.textContent = nativeUsable ? 'Native host ready' : 'Host not ready'
    if (!nativeUsable) {
      btnSetPac?.setAttribute('disabled', 'true')
      btnSetPacForce?.setAttribute('disabled', 'true')
    }
  } catch (e) {
    nativeUsable = false
    const msg = String((e && e.message) || e || '')
    // Common Chrome error when manifest missing or extension id mismatch
    if (/forbidden/i.test(msg)) {
      nativeMsg.textContent = 'Host forbidden: check manifest allowed_origins'
    } else if (/not.*found/i.test(msg)) {
      nativeMsg.textContent = 'Host not found: install manifest'
    } else {
      nativeMsg.textContent = msg || 'Native error'
    }
    btnSetPac?.setAttribute('disabled', 'true')
    btnSetPacForce?.setAttribute('disabled', 'true')
  }
}

async function setSystemPac(url) {
  if (!url) {
    nativeMsg.textContent = 'No PAC URL'
    return
  }
  if (platform?.os !== 'win') {
    nativeMsg.textContent = 'Windows only'
    return
  }
  if (!nativeUsable) {
    nativeMsg.textContent = 'Native host not available'
    return
  }
  nativeMsg.textContent = 'Applying…'
  try {
    const resp = await chrome.runtime.sendNativeMessage('com.tunnelstack.pacsetter', {
      cmd: 'set',
      url,
    })
    if (resp && resp.ok) {
      nativeMsg.textContent = 'Applied'
    } else {
      nativeMsg.textContent = resp?.error || 'Failed'
    }
  } catch (e) {
    nativeMsg.textContent = e.message || 'Native host error'
  }
}

// Silently apply PAC with force=1 (used after domain changes)
async function applyForcePacSilently() {
  try {
    if (platform?.os !== 'win' || !nativeUsable) return
    const cfg = await PacRegistry.ensureDefault()
    let url = buildPacUrl(cfg?.base, true)
    if (url && !/[?&]force=1(?!\d)/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'force=1'
    }
    await chrome.runtime.sendNativeMessage('com.tunnelstack.pacsetter', { cmd: 'set', url })
  } catch {
    // ignore errors silently
  }
}

btnSetPac?.addEventListener('click', async () => {
  const cfg = await PacRegistry.ensureDefault()
  let url = pacUrlInput.value.trim() || buildPacUrl(cfg?.base, false)
  // add cache-buster to force re-fetch
  url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now()
  setSystemPac(url)
})

btnSetPacForce?.addEventListener('click', async () => {
  const cfg = await PacRegistry.ensureDefault()
  // If input already has a value, respect it but ensure ?force=1
  let url = pacUrlInput.value.trim() || buildPacUrl(cfg?.base, true)
  if (url && !/[?&]force=1(?!\d)/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'force=1'
  }
  // add cache-buster to force re-fetch
  url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now()
  setSystemPac(url)
})
