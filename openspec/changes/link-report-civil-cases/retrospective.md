# Retrospective

The case relationship replaces copied display data with a foreign key while preserving the existing report-link identity. Manual intake and its recorded mutation chain perform the conversion; the website joins current case data for internal navigation.

Independent review exposed two partial-update consumers that rejected refined record schemas. Shared strict partial-field validation and reproducing regressions fix the cause. Validation also exposed outdated parser dependencies and invalid temporary-directory configuration; supported dependency updates and explicit environment unsetting fixed those causes without skips or relaxed assertions.
