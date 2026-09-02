#!/usr/bin/env node
/**
 * Administration for the AfyaCore sync server.
 *
 * This is a CLI rather than a set of HTTP routes on purpose. An admin API is a
 * second authentication surface, and the failure mode for a small deployment is
 * that it gets left open, or protected by a shared password in a chat message.
 * Requiring shell access to the box means the server's own attack surface is
 * exactly two endpoints: enrol and sync.
 *
 *   node server/cli.mjs facility:add    CSB2-Ambohidratrimo "CSB2 Ambohidratrimo" MG
 *   node server/cli.mjs facility:list
 *   node server/cli.mjs enrol:code      CSB2-Ambohidratrimo
 *   node server/cli.mjs device:list     CSB2-Ambohidratrimo
 *   node server/cli.mjs device:revoke   dev_xxx
 *   node server/cli.mjs audit:verify
 *   node server/cli.mjs audit:tail      CSB2-Ambohidratrimo 20
 */
import { openStore } from './store.mjs'
import { makeAuthQueries } from './auth.mjs'
import { makeAuditLog } from './audit.mjs'

const DB_PATH = process.env.AFYACORE_DB ?? './server/data/afyacore.db'

const USAGE = `AfyaCore sync server administration

  facility:add <id> <name> [country]   Create or rename a facility
  facility:list                        List facilities
  enrol:code <facilityId> [hours]      Mint a single-use enrolment code
  device:list <facilityId>             List enrolled devices
  device:revoke <deviceId>             Revoke a device's token immediately
  audit:verify                         Verify the audit hash chain
  audit:tail <facilityId> [n]          Show recent audit entries

Database: ${DB_PATH} (override with AFYACORE_DB)
`

const [command, ...args] = process.argv.slice(2)

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE)
  process.exit(0)
}

const db = openStore(DB_PATH)
const auth = makeAuthQueries(db)
const audit = makeAuditLog(db)

const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '—')

function requireArg(value, name) {
  if (!value) {
    console.error(`error: ${name} is required\n\n${USAGE}`)
    process.exit(1)
  }
  return value
}

switch (command) {
  case 'facility:add': {
    const id = requireArg(args[0], 'facility id')
    const name = requireArg(args[1], 'facility name')
    const country = (args[2] ?? 'MG').toUpperCase()
    const facility = auth.upsertFacility(id, name, country)
    audit.record({ facilityId: id, action: 'facility.upsert', detail: { name, country } })
    console.log(`facility ${facility.id} (${facility.name}) [${facility.country}]`)
    console.log(`\nNext: node server/cli.mjs enrol:code ${facility.id}`)
    break
  }

  case 'facility:list': {
    const rows = auth.listFacilities()
    if (rows.length === 0) {
      console.log('no facilities yet — node server/cli.mjs facility:add <id> <name> [country]')
      break
    }
    for (const f of rows) {
      const devices = auth.listDevices(f.id).filter((d) => !d.revoked_at).length
      console.log(
        `${f.id.padEnd(28)} ${f.country}  ${String(devices).padStart(3)} device(s)  ${f.name}${
          f.disabled_at ? '  [DISABLED]' : ''
        }`,
      )
    }
    break
  }

  case 'enrol:code': {
    const facilityId = requireArg(args[0], 'facility id')
    if (!auth.getFacility(facilityId)) {
      console.error(`error: no such facility: ${facilityId}`)
      process.exit(1)
    }
    const hours = Number(args[1] ?? 24)
    const { code, expiresAt } = auth.createEnrolmentCode(facilityId, hours * 3600_000)
    audit.record({ facilityId, action: 'enrol.code_issued', detail: { expiresAt } })
    console.log(`\n  enrolment code:  ${code}\n`)
    console.log(`  facility:        ${facilityId}`)
    console.log(`  expires:         ${when(expiresAt)} (${hours}h)`)
    console.log(`
  Single use. Read it to the person holding the phone, then enter it in
  Settings -> Sync -> Enrol this device. It is stored only as a hash, so if
  it is lost, issue another one.
`)
    break
  }

  case 'device:list': {
    const facilityId = requireArg(args[0], 'facility id')
    const rows = auth.listDevices(facilityId)
    if (rows.length === 0) {
      console.log(`no devices enrolled for ${facilityId}`)
      break
    }
    for (const d of rows) {
      console.log(
        `${d.id.padEnd(20)} ${when(d.created_at)}  last seen ${when(d.last_seen_at)}  ${d.name}${
          d.revoked_at ? `  [REVOKED ${when(d.revoked_at)}]` : ''
        }`,
      )
    }
    break
  }

  case 'device:revoke': {
    const deviceId = requireArg(args[0], 'device id')
    if (auth.revokeDevice(deviceId)) {
      audit.record({ facilityId: null, deviceId, action: 'device.revoked' })
      console.log(`revoked ${deviceId}. Its next sync will be refused.`)
      console.log('Note: records already synced to that device remain on it. For a lost phone,')
      console.log('revocation stops further access; it cannot erase what is already there.')
    } else {
      console.error(`error: no such active device: ${deviceId}`)
      process.exit(1)
    }
    break
  }

  case 'audit:verify': {
    const result = audit.verifyChain()
    if (result.ok) {
      console.log(`audit chain intact: ${result.entries} entries`)
      console.log(`head: ${result.head}`)
      console.log(
        '\nRecord this head hash somewhere off this server (the monthly report, an email\n' +
          'to the district) so a rewrite of the whole chain is also detectable.',
      )
    } else {
      console.error(`AUDIT CHAIN BROKEN at seq ${result.brokenAt} (${result.reason})`)
      console.error(`${result.entries} entries verified before the break.`)
      process.exit(2)
    }
    break
  }

  case 'audit:tail': {
    const facilityId = requireArg(args[0], 'facility id')
    const limit = Number(args[1] ?? 20)
    const rows = audit.recent(facilityId, limit)
    for (const row of rows.reverse()) {
      console.log(
        `${when(row.at)}  ${String(row.action).padEnd(18)} ${(row.device_id ?? '—').padEnd(20)} ${row.detail}`,
      )
    }
    break
  }

  default:
    console.error(`unknown command: ${command}\n\n${USAGE}`)
    process.exit(1)
}

db.close()
