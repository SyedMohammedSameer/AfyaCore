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

AfyaCore is an offline-first web application that turns a spoken consultation
into a structured, encrypted clinical record on the clinician's own phone, for
primary-care facilities in sub-Saharan Africa. Speech recognition (Whisper
base) and clinical de-identification (OpenMed PII) run on the device; no audio
and no record leaves it unless the facility configures synchronisation. A
deterministic extractor turns the transcript into typed fields, and nothing
machine-derived enters the record until a clinician confirms it beside its
source phrase. The system is functional end to end and technically validated,
including field accuracy measured from speech through the exact model files the
phone runs (632 automated tests, a fourteen-step offline walk with real
inference before and after a disconnected reload, de-identification scored
against gold annotations in the E3C clinical corpus); it has not yet been
evaluated with clinicians.

## Video link

<-- PASTE THE UNLISTED YOUTUBE / DRIVE LINK HERE -->

NOTE: the visible form has no video field. Confirm with info@ml4h.cc where the
link goes. A submission without a working video link is desk-rejected.

## Email Sharing / Data Release

Both must be ticked to submit.

## License

Your choice; CC BY 4.0 is the usual default for a non-archival track.
