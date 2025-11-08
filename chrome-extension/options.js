import { ServerRegistry, PacRegistry } from './api.js'

const serversTableBody = document.querySelector('#serversTable tbody')
const serversMsg = document.getElementById('serversMsg')
const addServerForm = document.getElementById('addServerForm')
const pacConfigForm = document.getElementById('pacConfigForm')
const pacMsg = document.getElementById('pacMsg')

async function loadServers() {
  const servers = await ServerRegistry.getAll()
  const activeId = await ServerRegistry.getActiveId()
  serversTableBody.innerHTML = ''
  servers.forEach((s) => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${s.id}</td><td>${s.name}</td><td>${s.allowlistBase}</td><td>${
      s.auth?.user || ''
    }</td><td>
      <button class='secondary' data-act='edit'>Edit</button>
      <button class='secondary' data-act='activate' ${
        s.id === activeId ? 'disabled' : ''
      }>Activate</button>
      <button class='danger' data-act='delete'>Delete</button>
    </td>`
    tr.querySelector('[data-act=edit]').onclick = () => fillForm(s)
    tr.querySelector('[data-act=activate]').onclick = async () => {
      await ServerRegistry.setActiveId(s.id)
      await loadServers()
    }
    tr.querySelector('[data-act=delete]').onclick = async () => {
      const rest = servers.filter((x) => x.id !== s.id)
      await ServerRegistry.saveAll(rest)
      if ((await ServerRegistry.getActiveId()) === s.id) {
        await ServerRegistry.setActiveId(rest[0]?.id || null)
      }
      await loadServers()
    }
    if (s.id === activeId) tr.style.background = '#0b1220'
    serversTableBody.appendChild(tr)
  })
  serversMsg.textContent = `${servers.length} servers (${
    activeId ? 'active: ' + activeId : 'no active'
  })`
}

function fillForm(s) {
  addServerForm.id.value = s.id
  addServerForm.name.value = s.name
  addServerForm.allowlistBase.value = s.allowlistBase
  addServerForm.user.value = s.auth?.user || ''
  addServerForm.pass.value = s.auth?.pass || ''
}

addServerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(addServerForm)
  const obj = Object.fromEntries(fd.entries())
  const server = {
    id: obj.id.trim(),
    name: obj.name.trim(),
    allowlistBase: obj.allowlistBase.trim().replace(/\/$/, ''),
    auth: { user: obj.user.trim(), pass: obj.pass },
  }
  const servers = await ServerRegistry.getAll()
  const idx = servers.findIndex((s) => s.id === server.id)
  if (idx >= 0) servers[idx] = server
  else servers.push(server)
  await ServerRegistry.saveAll(servers)
  if (!(await ServerRegistry.getActiveId())) await ServerRegistry.setActiveId(server.id)
  addServerForm.reset()
  await loadServers()
})
;(async function init() {
  await ServerRegistry.ensureDefault()
  await loadServers()
  // Load PAC config
  const cfg = await PacRegistry.ensureDefault()
  if (pacConfigForm) {
    pacConfigForm.base.value = cfg.base
    pacConfigForm.user.value = cfg.auth?.user || ''
    pacConfigForm.pass.value = cfg.auth?.pass || ''
  }
})()

// Handle PAC config save
pacConfigForm?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(pacConfigForm)
  const obj = Object.fromEntries(fd.entries())
  const cfg = {
    base: obj.base.trim().replace(/\/$/, ''),
    auth: { user: obj.user.trim(), pass: obj.pass },
  }
  try {
    await PacRegistry.saveConfig(cfg)
    pacMsg.textContent = 'Saved.'
    setTimeout(() => (pacMsg.textContent = ''), 1500)
  } catch (e2) {
    pacMsg.textContent = e2.message
  }
})
