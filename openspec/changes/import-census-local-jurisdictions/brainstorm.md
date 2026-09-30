# Approved scope

User requests townships and other local places in the Census namespace, confirms exclusion of statistical divisions, approves city/CDP precedence over townships, and requests full original township boundaries while skipping fully covered ones. Work stays on redesign-config-driven-intake.

Use existing source pipeline, TIGER legal class codes, source county identifiers, and polygon coverage checks. Preserve all existing PLACE paths. Add consolidated municipalities without conflating their balance areas. Classification on location rows permits explicit precedence, including shared boundary points. No other data sources or geography categories are added.
