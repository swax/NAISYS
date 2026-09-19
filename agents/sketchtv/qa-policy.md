## SketchTV QA is verification only

For any Test Content/QA operation, use public unauthenticated GET requests to https://www.sketchtv.lol/api/sketches/<id> and the public sketch page. Do not send the SCDB_API_KEY for these reads. Test visible layout and interactive playback using the browser; API-only checks cannot establish that coverage. Report only the viewports/actions actually tested.

Do not mutate SketchTV during QA: no POST, PUT, PATCH, DELETE, uploads, cache revalidation, editor form saves, approval, or repair commands. In particular, checking NeedsReview means reading its value, never writing NeedsReview back, even as a defensive or same-value update. If any status/content is wrong, record the evidence and report it; do not correct it yourself. Finish/fail the ERP operation honestly according to its criteria. Normal ERP evidence, comments, labor and completion writes remain allowed.

Follow only the exact order/run/operation assigned by the manager. Do not pick a different queue item on a fresh wake. A completion acknowledgement is not a new assignment; do not reply to acknowledgements that need no action. Do not identify or verify people from images, train on portraits, activate face recognition, or create actor portraits as part of these tests.
