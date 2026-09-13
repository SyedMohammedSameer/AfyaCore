/** Reproducible synthetic inputs. No model output is embedded in these clips. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const directory = new URL('../public/samples/', import.meta.url)
await mkdir(directory, { recursive: true })
const manifest = { kind: 'synthetic-tts', generator: 'macOS say', rate: 170, samples: [] }
for (const [locale, voice] of [['fr', 'Thomas'], ['en', 'Daniel']]) {
  const corpus = JSON.parse(await readFile(new URL(`../eval/corpus/extraction.${locale}.json`, import.meta.url)))
  const entry = corpus.cases[0]
  const output = new URL(`studio-${locale}.wav`, directory)
  execFileSync('/usr/bin/say', ['-v', voice, '-r', '170', '-o', fileURLToPath(output), '--file-format=WAVE', '--data-format=LEI16@16000', entry.text])
  const bytes = await readFile(output)
  if (bytes.length < 32_000) throw new Error(`Speech synthesis returned empty/short audio for ${locale}; check voice availability and sandbox permissions.`)
  manifest.samples.push({ locale, voice, caseId: entry.id, reference: entry.text,
    file: output.pathname.split('/').pop(), sha256: createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(new URL('studio-manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n')
console.log('Generated two synthetic speech fixtures and their reference/hash manifest.')
