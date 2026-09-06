import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { I18nProvider } from './i18n'
import { SkeletonRows } from './components/ui'
import { LockScreen } from './components/LockScreen'
import { HomeScreen } from './routes/Home'
import { SessionProvider, useSession } from './lib/session'
import {
  isChunkLoadError,
  markChunkLoadSucceeded,
  recoverFromStaleChunk,
} from './lib/chunkRecovery'

/**
 * `lazy`, plus a way back from a deploy that deleted this chunk.
 *
 * Hashed filenames mean a deploy renames every chunk, and a browser holding
 * the previous shell then asks for one that is gone. Unhandled that is a white
 * screen on the first navigation after every release, which on a phone in a
 * health post is indistinguishable from the app being broken.
 *
 * See `lib/chunkRecovery.ts` for why this clears the precache rather than
 * simply reloading, and why it only ever tries once.
 */
type RouteLoader = Parameters<typeof lazy>[0]

function lazyRoute(load: RouteLoader): ReturnType<typeof lazy> {
  return lazy(() =>
    load().then(
      (module) => {
        markChunkLoadSucceeded()
        return module
      },
      async (error: unknown) => {
        if (isChunkLoadError(error) && (await recoverFromStaleChunk())) {
          // The page is being replaced. Never resolving leaves the route
          // suspended for the moment it takes, which is the honest state:
          // there is nothing to render and an error would flash and vanish.
          return new Promise<never>(() => {})
        }
        throw error
      },
    ),
  )
}

/**
 * Every route except the home screen is split out.
 *
 * Home is what opens on launch, so it stays in the entry chunk; the rest
 * downloads on first use and is then cached by the service worker forever. On a
 * 2G connection the difference is felt on every cold install, which for this
 * deployment is the only install that matters.
 */
const Roster = lazyRoute(() => import('./routes/Roster').then((m) => ({ default: m.Roster })))
const NewPatient = lazyRoute(() => import('./routes/NewPatient').then((m) => ({ default: m.NewPatient })))
const MergePatient = lazyRoute(() =>
  import('./routes/MergePatient').then((m) => ({ default: m.MergePatient })),
)
const PatientProfile = lazyRoute(() =>
  import('./routes/PatientProfile').then((m) => ({ default: m.PatientProfile })),
)
const EncounterCapture = lazyRoute(() =>
  import('./routes/Encounter').then((m) => ({ default: m.EncounterCapture })),
)
const Review = lazyRoute(() => import('./routes/Review').then((m) => ({ default: m.Review })))
const Instructions = lazyRoute(() =>
  import('./routes/Instructions').then((m) => ({ default: m.Instructions })),
)
const Settings = lazyRoute(() => import('./routes/Settings').then((m) => ({ default: m.Settings })))

function RouteFallback() {
  return (
    <div className="mx-auto max-w-lg px-3 py-6">
      <SkeletonRows count={4} />
    </div>
  )
}

/**
 * Nothing renders until somebody is signed in.
 *
 * Deliberately a gate around the whole router rather than a guard on each
 * route. A guard per route is one somebody forgets to add to the next route,
 * and the failure is silent: the screen works, and only the audit trail is
 * wrong.
 */
function RequireSession({ children }: { children: ReactNode }) {
  const { clinician, ready } = useSession()
  if (!ready) return null
  if (!clinician) return <LockScreen />
  return <>{children}</>
}

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <RequireSession>
          <AppRoutes />
        </RequireSession>
      </SessionProvider>
    </I18nProvider>
  )
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/patients" element={<Roster />} />
          <Route path="/reports" element={<Settings />} />
          <Route path="/patient/new" element={<NewPatient />} />
          <Route path="/patient/:patientId" element={<PatientProfile />} />
          {/* Same component as /patient/new: it switches to edit mode on the
              presence of :patientId. See routes/NewPatient.tsx. */}
          <Route path="/patient/:patientId/edit" element={<NewPatient />} />
          <Route path="/patient/:patientId/merge" element={<MergePatient />} />
          <Route path="/patient/:patientId/encounter/:encounterId" element={<EncounterCapture />} />
          <Route path="/patient/:patientId/encounter/:encounterId/review" element={<Review />} />
          <Route
            path="/patient/:patientId/encounter/:encounterId/instructions"
            element={<Instructions />}
          />
          {/* Old path kept so an installed home-screen shortcut still resolves. */}
          <Route path="/settings" element={<Navigate to="/reports" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
