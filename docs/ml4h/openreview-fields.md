# OpenReview form fields

Copy-paste for https://openreview.net/group?id=ML4H/2026/Demo_Track

## Title

AfyaCore: On-Device Speech-to-Structured Clinical Records for Health Facilities Without Reliable Connectivity

## Keywords

clinical documentation, offline-first, on-device inference, speech recognition,
de-identification, global health, low-resource settings, progressive web app,
FHIR, DHIS2

## TL;DR

A phone app that turns a spoken consultation into a structured, encrypted
clinical record entirely on-device, for primary-care facilities with no reliable
network.

## Abstract

AfyaCore is an offline-first progressive web application that turns spoken
consultations into structured clinical records at primary-care facilities in
sub-Saharan Africa. Speech recognition (Whisper base, 72.6M parameters) and
clinical de-identification (OpenMed PII, 33M parameters) both run on the
clinician's own phone; no audio and no patient record reaches a network unless
the facility explicitly configures synchronisation. The clinician dictates a
consultation, an on-device transcript is parsed into typed clinical fields by a
deterministic extractor, and every machine-derived value is shown with its
provenance and must be confirmed by a human before it is committed. Records are
encrypted at rest under a key wrapped by the clinician's PIN, and export runs a
two-stage de-identification pass before anything leaves the device. The system
is a functional end-to-end application -- capture, structuring, human review,
encrypted storage, patient-facing instructions in ten languages, and FHIR R4 /
DHIS2 export across nine country profiles -- with an initial load of 143 kB. It
is validated technically (555 automated tests, a twelve-step offline walk
through a real browser, de-identification scored against gold annotations in the
E3C clinical corpus) but has not yet been evaluated with clinicians in a
facility, and the submission reports what is measured and what is not.

## Video link

<-- PASTE THE UNLISTED YOUTUBE / DRIVE LINK HERE -->

NOTE: the visible form has no video field. Confirm with info@ml4h.cc where the
link goes. A submission without a working video link is desk-rejected.

## Email Sharing / Data Release

Both must be ticked to submit.

## License

Your choice; CC BY 4.0 is the usual default for a non-archival track.
