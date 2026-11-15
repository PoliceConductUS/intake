# Implemented design

The existing schema-driven generator incorporates a maintained Markdown request
template and omits ArrestProfile from provider-facing record definitions. The
template owns the requested raw-data coverage, native-export conventions, and
request text. The generated document remains reproducible from the local schema
and template. See the delta spec for the exact approved request language and
verify.md for the recorded regression and reproducibility checks.

This closeout record describes the existing implementation; it adds no behavior.
