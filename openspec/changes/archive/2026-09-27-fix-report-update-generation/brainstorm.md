# Report updates discarded during generation

The user identified skipped changes to a manually authored report as a bug and requires data changes through CLI commands. An existing Review always produces ReviewRead because the registry sets upsert to read. This discards changed title, description, and desired_outcome before the mutation planner can diff them.

Use the existing generic update path for Review. Preserve canonical IDs, slugs, relationships, and unrelated columns. No namespace-specific exception or manual mutation workaround. Identical inputs remain no-op through the existing check-only update filter.
