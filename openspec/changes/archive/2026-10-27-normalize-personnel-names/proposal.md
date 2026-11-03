# Preserve source name spelling and normalize suffixes

## Why

The personal-name resolver overwrites mixed-case spelling explicitly supplied by
TCOLE, including Macomb, DeHoyos, LaRell and VanDevender. The namecase dependency
also consumes spaces after ST and other words. Suffixes JR and JR. currently
produce inconsistent display punctuation, as do SR and SR.

## What Changes

Preserve mixed-case personal-name spelling after whitespace normalization. Work
around the library's space consumption while retaining its existing display-case
heuristics for uniformly cased inputs. Those guesses do not verify preferred
personal spelling. Normalize case-insensitive JR and SR with any number of
trailing periods to Jr. and Sr., respectively, through the shared Personnel
suffix property resolver for every source. Preserve
nullable suffix behavior and existing handling for other suffixes.

Raw acquired inputs remain unchanged. No per-person or per-source exceptions.

## Impact

No migration, seed, identity, slug, dependency, or generated contract changes.
Regeneration uses the corrected resolvers; existing database rows and mutation
history do not change until newly generated mutations are applied. No cache
invalidation marker or full database reset is introduced.
