# ADR-0006: Use PostgreSQL trigram and full-text search for the food catalog

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The food catalog targets the Polish market. Product names are mostly Polish, some
English, and rarely Russian (63 of about 14,000 Polish products in Open Food Facts).
Users type queries in Polish, English or Russian, often without Polish diacritics.
Polish is heavily inflected, and PostgreSQL 18 has no Polish text-search configuration
or stemmer.

Text search is a secondary way to find food. In the product owner's current usage, about
80% of entries come from barcode scans, 10–15% are foods entered by hand after a failed
scan, and about 5% come from text search. A planned AI assistant will reduce that share
further.

[ADR-0005](0005-postgresql-primary-database.md) left open whether search needs a
dedicated engine. A spike on Open Food Facts data (about 14,000 Polish products for
relevance, 2.06 million product names for scale) compared the options:

- Normalizing text to lowercase without diacritics (`unaccent`) makes `zolty` match
  `żółty`.
- Trigram word similarity (`pg_trgm`) tolerates typos (`mlekko` finds _Mleko_) and some
  inflected forms. It returned results in 5–73 ms on 2.06 million names, with a 96 MB
  index.
- Prefix full-text search (`simple` configuration) is precise and under 1 ms (41 MB
  index), but misses typos and inflected forms.
- Russian queries found nothing with any method, because the data has almost no Russian
  names. A search engine cannot fix missing data.

## Considered options

1. **PostgreSQL: `unaccent` + `pg_trgm` + prefix full-text search.** Pros: no new
   infrastructure; results are consistent with writes, so a newly entered food is
   searchable at once; fast at full Open Food Facts scale; both extensions ship with
   PostgreSQL and are offered by managed services. Cons: no Polish stemming; heuristic
   ranking (similarity and popularity) instead of BM25.
2. **PostgreSQL with a Polish Ispell dictionary.** Pros: real Polish stemming in
   full-text search. Cons: dictionary files must be installed on the database server,
   which means a custom image locally and uncertain support on managed PostgreSQL; it
   doesn't help with typos or the lack of Russian names.
3. **OpenSearch next to PostgreSQL.** Pros: BM25 ranking, Polish analyzers (Stempel,
   Morfologik), fuzzy matching, autocomplete. Cons: a second datastore to run and pay
   for; a sync pipeline from PostgreSQL with eventual consistency; a large cost for about
   5% of usage.

## Decision

We will use **PostgreSQL with `unaccent`, `pg_trgm` and prefix full-text search** for
catalog search, behind a search interface inside the catalog service. Search is a
secondary path, the spike showed this is good enough and fast at full scale, and it
adds no infrastructure.

## Consequences

**Positive**

- One datastore. Search results are always consistent with the catalog.
- The interface keeps a dedicated engine an implementation swap, not a redesign.

**Negative**

- Without stemming, some inflected Polish forms rank lower or are missed.
- The normalization function must be declared `IMMUTABLE` to be indexable. Changing the
  `unaccent` rules requires a reindex.

**Follow-ups**

- Revisit with OpenSearch post-MVP if text search becomes a primary path (for example
  through the AI assistant), or if missed inflected forms become a real problem.
- Russian names have to come from data (user-entered foods, AI-assisted translation),
  not from the search engine.
- The importer must clean names: HTML entities such as `&quot;`, and names in the wrong
  script.
