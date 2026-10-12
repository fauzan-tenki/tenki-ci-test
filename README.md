# tenki-ci-test

Runs the same jobs on Tenki CI, GitHub-hosted runners and Tenki runners, then compares timings.

| File                                       | Runs on                          |
| ------------------------------------------ | -------------------------------- |
| `.tenki/workflows/*.yml`                   | Tenki CI                         |
| `.github/workflows/bench.yml`              | GitHub-hosted `ubuntu-latest`    |
| `.github/workflows/bench-tenki-runner.yml` | GitHub Actions on a Tenki runner |

The bench workflows are generated from `templates/bench.yml`; edit the template, then run `scripts/gen-workflows.sh`.

## Measure

```sh
node scripts/measure.mjs --push --runs 3   # empty commit, push, wait for every check, record timings
node scripts/measure.mjs <sha> --wait      # measure an existing commit
```

Timings come from the check runs each system publishes on the commit and are appended to `results/runs.jsonl`.
