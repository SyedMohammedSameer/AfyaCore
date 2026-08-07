import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { I18nProvider } from './i18n'
import { SkeletonRows } from './components/ui'
import { HomeScreen } from './routes/Home'

/**
 * Every route except the home screen is split out.
 *
 * Home is what opens on launch, so it stays in the entry chunk; the rest
 * downloads on first use and is then cached by the service worker forever. On a
 * 2G connection the difference is felt on every cold install, which for this
 * deployment is the only install that matters.
 */
const Roster = lazy(() => import('./routes/Roster').then((m) => ({ default: m.Roster })))
const NewPatient = lazy(() => import('./routes/NewPatient').then((m) => ({ default: m.NewPatient })))
const PatientProfile = lazy(() =>
  import('./routes/PatientProfile').then((m) => ({ default: m.PatientProfile })),
)
const EncounterCapture = lazy(() =>
  import('./routes/Encounter').then((m) => ({ default: m.EncounterCapture })),
)
const Review = lazy(() => import('./routes/Review').then((m) => ({ default: m.Review })))
const Instructions = lazy(() =>
  import('./routes/Instructions').then((m) => ({ default: m.Instructions })),
)
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })))

function RouteFallback() {
  return (
    <div className="mx-auto max-w-lg px-3 py-6">
      <SkeletonRows count={4} />
    </div>
  )
}

export function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/patients" element={<Roster />} />
            <Route path="/reports" element={<Settings />} />
            <Route path="/patient/new" element={<NewPatient />} />
            <Route path="/patient/:patientId" element={<PatientProfile />} />
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
    </I18nProvider>
  )
}
