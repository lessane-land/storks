# Research notes, cigüeñas.lessane.es

Checked on 5 November 2026 against Movebank's anonymous endpoints. No account was used; the site must only ever show what an anonymous visitor can see.

## Movebank, how it works

- Public data: `https://www.movebank.org/movebank/service/public/json` works without credentials. Movebank's API documentation says these JSON requests exist "primarily to allow users to access and display mapped Movebank data" on external pages. Source: https://github.com/movebank/movebank-api-doc/blob/master/movebank-api.md
- Study list: `public/json?entity_type=study` returns every public study (170 on 5 Nov 2026). Each entry carries `id`, `name`, `suspend_license_terms` and `sensor_type_ids`. The licence field itself is not exposed to anonymous callers.
- Latest fix per bird: `public/json?study_id=ID&sensor_type=gps&max_events_per_individual=1`.
- `direct-read` needs a login (401 anonymously). Not used.
- Rate limit: one concurrent request per IP, 20 total. Source: API documentation above. This is why the site reads a cached JSON, never Movebank directly.
- Licences: owners of public studies pick CC0, CC BY or CC BY-NC. A licence covers only the part the public can see. Movebank does not enforce it; we do. Source: https://www.movebank.org/cms/movebank-content/data-policy

## Public white stork studies on Movebank

Ten public studies with "stork" in the name. Latest public GPS fix on 5 Nov 2026:

| Movebank ID | Study | Birds | Latest fix | Live |
|---|---|---|---|---|
| 21231406 | LifeTrack White Stork SW Germany | 92 | 2026-11-05 10:30 UTC | Louis, near Lleida |
| 10449318 | LifeTrack White Stork Loburg | 41 | 2026-11-04 | Mose, Jordan valley |
| 1562253659 | LifeTrack White Stork Sarralbe [ID_PROG 1093] | 7 | 2026-08-31 | no |
| 10449698 | HUJ MPIAB White Stork GSM 2013 | 15 | 2022-04 | no |
| 10236270 | LifeTrack White Stork Armenia | 11 | 2018-01 | no |
| 128184877 | White Stork Bulgaria | 4 | 2018-02 | no |
| 10157679 | LifeTrack White Stork Tunisia | 9 | 2015-12 | no |
| 7002955 | HUJ MPIAB White Stork GSM E-Obs | 18 | 2015-09 | no |
| 463766103 | Black Stork Belarus | | | other species |
| 8644294327 | Woolly-necked Storks, KwaZulu-Natal | | | other species |

Names are in the data: `individual_local_identifier` looks like `Louis / DER AU050 (eobs 3264)`. A `+` after the name marks a dead bird in the LifeTrack studies (to confirm with the study owners before we show it).

SW Germany birds with Iberian winters in the archive, last public fix: Angela (2025-10, Sevilla), Mirabell (2020-09, Ciudad Real), Ed (2021-12, Sevilla), Elton (2021-08, Granada), Fritz (2021-08, Teruel), Zozu and Sierit (2021, Lleida).

## Licences, verified

Archived versions on the Movebank Data Repository, all CC0 1.0 Universal, citation expected:

- Data from: Study "LifeTrack White Stork SW Germany" (2013-2023). Fiedler W, Flack A, Schäfle W, Keeves B, Quetting M, Eid B, Schmid H, Wikelski M. 2024. doi:10.5441/001/1.ck04mn78_2. https://datarepository.movebank.org/handle/10255/move.1685
- Data from: Study "LifeTrack White Stork Oberschwaben" (2014-2023). Fiedler W, Flack A, Schmid A, Reinhard U, Wikelski M. 2024. doi:10.5441/001/1.c42j3js7_2. https://datarepository.movebank.org/handle/10255/move.1683
- Data from: Study "LifeTrack White Stork Bavaria" (2014-2023). https://datarepository.movebank.org/handle/10255/move.1686
- Data from: Study "LifeTrack White Stork Vorarlberg" (2016-2023). https://datarepository.movebank.org/handle/10255/move.1684
- Data from: Study "LifeTrack White Stork Rheinland-Pfalz" (2015-2023). https://datarepository.movebank.org/handle/10255/move.1687
- Data from: Study "MPIAB Argos white stork tracking (1991-2017)". Berthold P, Kaatz C, Kaatz M, Querner U, van den Bossche W, Chernetsov N, Fiedler W, Wikelski M. 2022. doi:10.5441/001/1.k29d81dh. Over 200 storks tagged in Belgium, Germany, Greece, Israel, Poland, Russia, South Africa, Spain and Switzerland, including Prinzesschen, tracked for over a decade. https://datarepository.movebank.org/handle/10255/move.743
- Also CC0: LifeTrack White Stork Kosova (move.1339), Sicily (move.1343), and the papers "Costs of migratory decisions" (move.417), "The challenges of the first migration" (move.530), "The price of being late" (move.1627, 1632, 1633).

Live studies (SW Germany, Loburg): licence not readable anonymously, `suspend_license_terms: true` (no click-through terms). Same owners have released every year up to 2023 as CC0. Decision: show live fixes credited to the study, the authors and Movebank, and write to the owners (Wolfgang Fiedler, Max Planck Institute of Animal Behavior) to tell them about the site.

## Not usable yet

- SEO/BirdLife Migra (Spain, migraciondeaves.org): Spanish birds with Madrid stories (Blas from Pinilla del Valle, Goyo and Enara wintering on a Madrid tip, Yerga from La Rioja to Senegal). No open licence found, not on public Movebank. Worth asking.
- NABU (Germany), Storch Schweiz, White Stork Project (UK), Lonjsko polje (Croatia): own maps, own birds, no open data found.
- Animal Tracker (Max Planck app): live, worldwide, scientific tone.

## What exists already

Every existing map is one project's own birds, one country, data-dashboard tone. Nothing uses Iberia as the stage, merges studies, or replays the archive on today's date.

## Product decision

- Live layer: the public live birds, with the time of the last fix stated. New public birds appear on their own when the cache job lists the studies.
- Memory layer: the CC0 archive replayed on today's date of past years, named and credited.
- Stories: only from the studies' own abstracts and papers, quoted and credited.
- Cache: a Supabase Edge Function on a cron reads Movebank and writes one JSON. The page reads the JSON. No keys in the repo.
